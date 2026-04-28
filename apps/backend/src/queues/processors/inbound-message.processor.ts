// Inbound Message Processor
// - `persist`: store inbound message, bump debounce version, schedule delayed orchestration (default).
// - `orchestrate`: after quiet window, run routing + reply planning (single batch per version).
// - `smokeImmediate` on persist payload skips debounce (manual / header-driven smoke tests).

import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { QUEUES } from '../queue.constants';
import { ConversationOrchestrationService } from '../../modules/orchestration/orchestration.service';
import type { NormalizedWebhookPayload } from '../../modules/webhooks/dto/ghl-webhook.payload';
import { bumpInboundDebounceMeta, shouldSkipStaleDebounceJob } from '../../lib/inbound-debounce';
import { classifyConversationIntent } from '../../modules/conversation-policy/conversation-intent';
import { deriveConversationIdentity } from '../../lib/conversation-identity';

export interface InboundMessageJobData {
  locationId: string;
  ghlConversationId: string;
  ghlContactId: string;
  messageContent: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  timestamp: string;
  webhookEventId?: string;
  /** When true, persist then run orchestration immediately (no 5s debounce). */
  smokeImmediate?: boolean;
}

export interface OrchestrateDebouncedJobData {
  tenantId: string;
  conversationId: string;
  locationId: string;
  ghlContactId: string;
  ghlConversationId: string;
  debounceVersion: number;
  webhookEventId?: string;
}

const DEBOUNCE_MS = 5000;

@Processor(QUEUES.INBOUND_MESSAGE_PROCESSOR)
@Injectable()
export class InboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundMessageProcessor.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly orchestrationService: ConversationOrchestrationService,
    @InjectQueue(QUEUES.SEND_BUBBLE) private readonly sendBubbleQueue: Queue,
    @InjectQueue(QUEUES.INBOUND_MESSAGE_PROCESSOR) private readonly inboundQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<InboundMessageJobData | OrchestrateDebouncedJobData>): Promise<void> {
    if (job.name === 'orchestrate') {
      await this.runOrchestrationAfterDebounce(job as Job<OrchestrateDebouncedJobData>);
      return;
    }
    await this.runPersistInboundPipeline(job as Job<InboundMessageJobData>);
  }

  private async runPersistInboundPipeline(job: Job<InboundMessageJobData>): Promise<void> {
    const {
      locationId,
      ghlConversationId,
      ghlContactId,
      messageContent,
      messageType,
      timestamp,
      webhookEventId,
      smokeImmediate,
    } = job.data;

    this.logger.log(
      `Inbound persist: conversationGhlId=${ghlConversationId}, type=${messageType}, smokeImmediate=${Boolean(smokeImmediate)}`,
    );

    if (webhookEventId) {
      await this.updateWebhookEventStatus(webhookEventId, 'PROCESSING');
    }

    try {
      const tenant = await this.findTenantByLocationId(locationId);
      if (!tenant) {
        throw new Error(`Tenant not found for locationId: ${locationId}`);
      }

      const conversation = await this.getOrCreateConversation(
        tenant.id,
        ghlConversationId,
        ghlContactId,
        timestamp,
        locationId,
      );

      await this.addMessage(conversation.id, {
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: messageContent,
        contentType: messageType,
        metadata: {
          ghlMessageId: webhookEventId,
          receivedAt: timestamp,
        },
      });

      this.logger.log(`Inbound message stored: conversationId=${conversation.id}, messageType=${messageType}`);

      if (smokeImmediate) {
        this.logger.log(`Debounce bypassed (smokeImmediate): conversationId=${conversation.id}`);
        await this.executeOrchestrationPipeline({
          tenantId: tenant.id,
          conversationId: conversation.id,
          locationId,
          ghlContactId,
          ghlConversationId,
          webhookEventId,
          latestInboundText: messageContent,
        });
        if (webhookEventId) await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
        return;
      }

      const { data: convMetaRow } = await this.supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversation.id)
        .single();
      const { merged, newVersion } = bumpInboundDebounceMeta(convMetaRow?.metadata);
      const { error: metaErr } = await this.supabase
        .from('conversations')
        .update({ metadata: merged, updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
      if (metaErr) {
        this.logger.warn(`Failed to bump inbound debounce metadata: ${formatPostgrestError(metaErr)}`);
      }

      await this.inboundQueue.add(
        'orchestrate',
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          locationId,
          ghlContactId,
          ghlConversationId,
          debounceVersion: newVersion,
          webhookEventId,
        } satisfies OrchestrateDebouncedJobData,
        {
          delay: DEBOUNCE_MS,
          jobId: `deb:${conversation.id}:${newVersion}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 1500 },
          removeOnComplete: true,
        },
      );

      this.logger.log(
        `Debounce scheduled: conversationId=${conversation.id}, processAfterMs=${DEBOUNCE_MS}, version=${newVersion}`,
      );

      if (webhookEventId) {
        await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
      }
    } catch (error) {
      const message = formatPostgrestError(error);
      this.logger.error(`Failed to process inbound message: ${message}`);
      if (webhookEventId) {
        await this.updateWebhookEventStatus(webhookEventId, 'FAILED', message);
      }
      throw error;
    }
  }

  private async runOrchestrationAfterDebounce(job: Job<OrchestrateDebouncedJobData>): Promise<void> {
    const { tenantId, conversationId, locationId, ghlContactId, ghlConversationId, debounceVersion, webhookEventId } =
      job.data;

    const { data: convRow, error: cErr } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .single();
    if (cErr || !convRow) {
      this.logger.warn(`Debounce orchestrate: conversation not found ${conversationId}`);
      return;
    }

    if (shouldSkipStaleDebounceJob(convRow.metadata, debounceVersion)) {
      this.logger.log(
        `Debounce skipped: newer inbound exists conversationId=${conversationId} (jobVersion=${debounceVersion})`,
      );
      return;
    }

    const recentBatch = await this.fetchRecentInboundBatch(conversationId);
    const latestText = recentBatch.length ? recentBatch[recentBatch.length - 1]! : '';

    const latestIntent = latestText ? classifyConversationIntent(latestText) : 'UNKNOWN';
    const combinedText = recentBatch.join(' ').trim();
    this.logger.log(
      `Debounce processing batch: conversationId=${conversationId}, messageCount=${recentBatch.length}, ` +
        `latestIntent=${latestIntent}, combinedTextPreviewLen=${combinedText.length}, ` +
        `inboundBatchCount=${recentBatch.length}`,
    );

    await this.executeOrchestrationPipeline({
      tenantId,
      conversationId,
      locationId,
      ghlContactId,
      ghlConversationId,
      webhookEventId,
      latestInboundText: latestText,
      recentInboundBatch: recentBatch,
    });
  }

  private async executeOrchestrationPipeline(ctx: {
    tenantId: string;
    conversationId: string;
    locationId: string;
    ghlContactId: string;
    ghlConversationId: string;
    webhookEventId?: string;
    latestInboundText: string;
    recentInboundBatch?: string[];
  }): Promise<void> {
    const {
      tenantId,
      conversationId,
      locationId,
      ghlContactId,
      ghlConversationId,
      webhookEventId,
      latestInboundText,
      recentInboundBatch,
    } = ctx;

    const normalizedPayload: NormalizedWebhookPayload = {
      ghlLocationId: locationId,
      ghlConversationId,
      ghlContactId,
      messageContent: latestInboundText,
      messageType: 'text',
      timestamp: new Date().toISOString(),
      externalEventId: webhookEventId ?? `local:${conversationId}:${Date.now()}`,
      eventType: 'inbound_message',
      dedupeKey: `orch:${conversationId}:${Date.now()}`,
      channelRaw: null,
    };

    const tenantContext = await this.orchestrationService.loadTenantContext(tenantId);
    const promptConfig = await this.orchestrationService.loadPromptConfig(tenantId);
    const agencyPolicy = await this.orchestrationService.loadAgencyPolicy(tenantId);
    const conversationRecord = await this.orchestrationService.loadConversation(conversationId);

    const orchestrationInput = {
      tenantId,
      conversationId,
      webhookEventId,
      incomingMessage: normalizedPayload,
      tenant: tenantContext ?? undefined,
      promptConfig: promptConfig ?? undefined,
      agencyPolicy: agencyPolicy ?? undefined,
      conversation: conversationRecord ?? undefined,
      ...(recentInboundBatch?.length ? { recentInboundBatch } : {}),
    };

    const result = await this.orchestrationService.orchestrate(orchestrationInput);

    if (result.outcome === 'PROCEED' && result.replyPlan && result.replyPlan.bubbles.length > 0) {
      const mode = tenantContext?.botMode ?? 'autopilot';
      if (mode === 'suggestive') {
        this.logger.log(
          `Suggestive mode: skipping GHL send for conversationId=${conversationId} (drafts in orchestration log)`,
        );
      } else {
        await this.sendBubbleQueue.add('send-bubble', {
          conversationId,
          tenantId,
          contactId: ghlContactId,
          ghlLocationId: locationId,
          replyPlanJson: JSON.stringify(result.replyPlan),
        });

        this.logger.log(
          `Send-bubble job enqueued: conversationId=${conversationId}, bubbleCount=${result.replyPlan.bubbles.length}`,
        );
      }
    }

    this.logger.log(
      `Orchestration result: conversationId=${conversationId}, outcome=${result.outcome}, ` +
        `routingRecommendedModel=${result.routing?.recommendedModel ?? 'n/a'}, ` +
        `generationModelActuallyUsed=${result.replyPlan?.generationModelActuallyUsed ?? result.replyPlan?.generationModel ?? 'n/a'}`,
    );
  }

  private async fetchRecentInboundBatch(conversationId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('content, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .order('created_at', { ascending: true })
      .limit(25);
    if (error || !data?.length) return [];
    return data.map(r => String(r.content ?? '').trim()).filter(Boolean);
  }

  private async findTenantByLocationId(locationId: string): Promise<{ id: string } | null> {
    const { data } = await this.supabase.from('tenants').select('id').eq('ghl_location_id', locationId).single();
    return data;
  }

  /**
   * Stable conversation lookup:
   * 1. If provider supplied a real conversation id, look it up directly.
   * 2. Otherwise (or if not yet stored), look up by tenant + channel + contactId via the
   *    derived `aisbp:conv:<channel>:<tenant>:<contact>` key stored in `ghl_conversation_id`.
   * 3. As a final safety net, look up by `(tenant_id, contact_id, channel)` so legacy rows
   *    created with provisional / different keys are still reused.
   *
   * One stable internal conversation per contact per channel — debounce, option memory, booking
   * state and all downstream policy logic depend on this.
   */
  private async getOrCreateConversation(
    tenantId: string,
    ghlConversationId: string,
    contactId: string,
    timestamp: string,
    locationId: string,
  ): Promise<{ id: string; reused: boolean; derivedKeyHash: string }> {
    const identity = deriveConversationIdentity({
      tenantId,
      channel: 'WHATSAPP',
      externalContactId: contactId,
      externalConversationId: ghlConversationId,
    });

    const safeLog = (
      reusedExisting: boolean,
      internalId: string,
      reason: string,
    ): void => {
      this.logger.log(
        `Conversation identity: locationId=${locationId} tenantId=${tenantId} channel=${identity.channel} ` +
          `contactIdPresent=${Boolean(contactId?.trim())} ` +
          `externalConversationIdPresent=${identity.externalConversationId !== null} ` +
          `derivedKeyHash=${identity.derivedKeyHash} reusedExistingConversation=${reusedExisting} ` +
          `internalConversationId=${internalId} reason=${reason}`,
      );
    };

    // 1) Try the provider-supplied id (highest priority).
    if (identity.externalConversationId) {
      const { data: existing } = await this.supabase
        .from('conversations')
        .select('id')
        .eq('ghl_conversation_id', identity.externalConversationId)
        .maybeSingle();
      if (existing) {
        safeLog(true, existing.id, 'external_conversation_id');
        return { id: existing.id, reused: true, derivedKeyHash: identity.derivedKeyHash };
      }
    }

    // 2) Try the derived key (works whether or not external id was present).
    const { data: derivedExisting } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_conversation_id', identity.derivedConversationKey)
      .maybeSingle();
    if (derivedExisting) {
      safeLog(true, derivedExisting.id, 'derived_conversation_key');
      return { id: derivedExisting.id, reused: true, derivedKeyHash: identity.derivedKeyHash };
    }

    // 3) Fallback: legacy rows for the same (tenant, contact, channel) — pick the most recent.
    const { data: legacyMatches } = await this.supabase
      .from('conversations')
      .select('id, ghl_conversation_id, last_message_at, metadata')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .eq('channel', 'WHATSAPP')
      .order('last_message_at', { ascending: false })
      .limit(1);
    const legacy = Array.isArray(legacyMatches) ? legacyMatches[0] : null;
    if (legacy) {
      const prevMeta =
        legacy.metadata && typeof legacy.metadata === 'object' && !Array.isArray(legacy.metadata)
          ? (legacy.metadata as Record<string, unknown>)
          : {};
      const merged = {
        ...prevMeta,
        derivedConversationKey: identity.derivedConversationKey,
        externalContactId: contactId,
        channel: identity.channel,
        locationId,
        ...(identity.externalConversationId
          ? { externalConversationId: identity.externalConversationId }
          : {}),
      };
      const ghlIdToWrite = identity.externalConversationId ?? identity.derivedConversationKey;
      const { error: upErr } = await this.supabase
        .from('conversations')
        .update({
          ghl_conversation_id: ghlIdToWrite,
          metadata: merged,
          updated_at: new Date().toISOString(),
        })
        .eq('id', legacy.id);
      if (upErr) {
        this.logger.warn(
          `Failed to backfill stable identity on legacy conversation ${legacy.id}: ${formatPostgrestError(upErr)}`,
        );
      }
      safeLog(true, legacy.id, 'legacy_tenant_contact_channel');
      return { id: legacy.id, reused: true, derivedKeyHash: identity.derivedKeyHash };
    }

    // 4) Truly first message — create a new row using the derived key (or external id when present).
    const now = new Date().toISOString();
    const newId = randomUUID();
    const ghlIdToWrite = identity.externalConversationId ?? identity.derivedConversationKey;
    const metadata: Record<string, unknown> = {
      derivedConversationKey: identity.derivedConversationKey,
      externalContactId: contactId,
      channel: identity.channel,
      locationId,
      createdFromTimestamp: timestamp,
      ...(identity.externalConversationId
        ? { externalConversationId: identity.externalConversationId }
        : { derivedFromContact: true }),
    };

    const { data, error } = await this.supabase
      .from('conversations')
      .insert({
        id: newId,
        tenant_id: tenantId,
        ghl_conversation_id: ghlIdToWrite,
        contact_id: contactId,
        channel: 'WHATSAPP',
        status: 'ACTIVE',
        last_message_at: now,
        updated_at: now,
        metadata,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create conversation: ${formatPostgrestError(error)}`);
    }

    safeLog(false, data.id, 'created_new');
    return { id: data.id, reused: false, derivedKeyHash: identity.derivedKeyHash };
  }

  private mapToDbContentType(
    label: InboundMessageJobData['messageType'] | string,
  ): 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' {
    const upper = String(label).toUpperCase();
    if (
      upper === 'TEXT' ||
      upper === 'IMAGE' ||
      upper === 'VIDEO' ||
      upper === 'DOCUMENT' ||
      upper === 'AUDIO'
    ) {
      return upper as 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO';
    }
    const u = String(label).toLowerCase();
    if (u === 'image') return 'IMAGE';
    if (u === 'audio') return 'AUDIO';
    if (u === 'video') return 'VIDEO';
    if (u === 'document') return 'DOCUMENT';
    return 'TEXT';
  }

  private async addMessage(
    conversationId: string,
    message: {
      direction: string;
      sender: string;
      content: string;
      contentType: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const { error } = await this.supabase.from('messages').insert({
      id: randomUUID(),
      conversation_id: conversationId,
      direction: message.direction,
      sender: message.sender,
      content: message.content,
      contentType: this.mapToDbContentType(message.contentType),
      metadata: message.metadata,
    });

    if (error) {
      throw new Error(`Failed to add message: ${formatPostgrestError(error)}`);
    }
  }

  private async updateWebhookEventStatus(
    webhookEventRowId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      processing_status: status,
      processed_at: new Date().toISOString(),
    };

    if (errorMessage) {
      updateData['processing_error'] = errorMessage;
    }

    const { error } = await this.supabase.from('webhook_events').update(updateData).eq('id', webhookEventRowId);

    if (error) {
      this.logger.warn(`Webhook event status update failed (id=${webhookEventRowId}): ${formatPostgrestError(error)}`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Inbound message job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Inbound message job ${job.id} failed: ${formatPostgrestError(error)}`);
  }
}
