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
import {
  INBOUND_DEBOUNCE_MS,
  filterInboundRowsToBurstWindow,
} from '../../lib/inbound-burst-batch';
import { matchChatResetCommand } from '../../lib/chat-reset-command';
import { ConversationResetService } from '../../modules/conversations/conversation-reset.service';
import { InboundAutoTaggingService } from '../../modules/intent-tags/inbound-auto-tagging.service';
import {
  AudioTranscriptionService,
  VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
} from '../../modules/transcription/audio-transcription.service';
import { GhlVoiceRecordingFetchService } from '../../modules/transcription/ghl-voice-recording-fetch.service';
import { classifyGhlAudioPlaceholderBody } from '../../modules/webhooks/ghl-inbound-audio-media';

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
  contactDisplayName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactFieldsFromExtendedWebhook?: boolean;
  /** Inbound audio media URL from GHL webhook (attachments / media). */
  audioMediaUrl?: string | null;
  /** When true, run speech-to-text before persisting message content. */
  voiceInboundNeedsTranscribe?: boolean;
  /** GHL placeholder voice inbound with no media URL — persist metadata only, no transcription. */
  voiceInboundAudioPlaceholderWithoutMediaUrl?: boolean;
  /** Raw placeholder body before webhook replaced message text (Phase 1B). */
  voiceInboundPlaceholderRawBody?: string;
  /** Outbound GHL message id from webhook data.id (recording fetch). */
  ghlInboundMessageId?: string;
}

export interface OrchestrateDebouncedJobData {
  tenantId: string;
  conversationId: string;
  locationId: string;
  ghlContactId: string;
  ghlConversationId: string;
  debounceVersion: number;
  webhookEventId?: string;
  contactDisplayName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactFieldsFromExtendedWebhook?: boolean;
}

const DEBOUNCE_MS = INBOUND_DEBOUNCE_MS;

@Processor(QUEUES.INBOUND_MESSAGE_PROCESSOR)
@Injectable()
export class InboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundMessageProcessor.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly orchestrationService: ConversationOrchestrationService,
    private readonly conversationResetService: ConversationResetService,
    private readonly inboundAutoTagging: InboundAutoTaggingService,
    private readonly audioTranscription: AudioTranscriptionService,
    private readonly ghlVoiceRecordingFetch: GhlVoiceRecordingFetchService,
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
      contactDisplayName,
      contactPhone,
      contactEmail,
      contactFieldsFromExtendedWebhook,
      audioMediaUrl,
      voiceInboundNeedsTranscribe,
      voiceInboundAudioPlaceholderWithoutMediaUrl,
      voiceInboundPlaceholderRawBody,
      ghlInboundMessageId,
    } = job.data;

    this.logger.log(
      `Inbound persist: conversationGhlId=${ghlConversationId}, type=${messageType}, smokeImmediate=${Boolean(smokeImmediate)}, voiceInboundNeedsTranscribe=${Boolean(voiceInboundNeedsTranscribe)}`,
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

      const resolved = await this.resolveVoiceInboundContent(
        {
          messageContent,
          messageType,
          audioMediaUrl: audioMediaUrl ?? null,
          voiceInboundNeedsTranscribe: Boolean(voiceInboundNeedsTranscribe),
          voiceInboundAudioPlaceholderWithoutMediaUrl: Boolean(
            voiceInboundAudioPlaceholderWithoutMediaUrl,
          ),
          voiceInboundPlaceholderRawBody,
          ghlInboundMessageId,
        },
        tenant.id,
        conversation.id,
        webhookEventId,
        locationId,
      );

      await this.addMessage(conversation.id, {
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: resolved.content,
        contentType: resolved.persistContentType,
        metadata: {
          ghlMessageId: webhookEventId,
          receivedAt: timestamp,
          ...resolved.voiceMetadata,
        },
      });

      this.logger.log(
        `Inbound message stored: conversationId=${conversation.id}, messageType=${resolved.persistContentType}`,
      );

      if (smokeImmediate) {
        this.logger.log(`Debounce bypassed (smokeImmediate): conversationId=${conversation.id}`);
        await this.executeOrchestrationPipeline({
          tenantId: tenant.id,
          conversationId: conversation.id,
          locationId,
          ghlContactId,
          ghlConversationId,
          webhookEventId,
          latestInboundText: resolved.content,
          contactDisplayName,
          contactPhone,
          contactEmail,
          contactFieldsFromExtendedWebhook,
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
          contactDisplayName,
          contactPhone,
          contactEmail,
          contactFieldsFromExtendedWebhook,
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

  /**
   * Voice / audio inbound: transcribe server-side and persist plain text for the existing orchestration path.
   * Raw audio is never forwarded to the text reply model — only the transcript (or a safe fallback string).
   */
  private async resolveVoiceInboundContent(
    job: Pick<
      InboundMessageJobData,
      | 'messageContent'
      | 'messageType'
      | 'audioMediaUrl'
      | 'voiceInboundNeedsTranscribe'
      | 'voiceInboundAudioPlaceholderWithoutMediaUrl'
      | 'voiceInboundPlaceholderRawBody'
      | 'ghlInboundMessageId'
    >,
    tenantId: string,
    conversationId: string,
    webhookEventId: string | undefined,
    locationId: string,
  ): Promise<{
    content: string;
    persistContentType: InboundMessageJobData['messageType'];
    voiceMetadata: Record<string, unknown>;
  }> {
    const fetchRecordingEnabled =
      process.env['GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID'] === 'true';
    const rawPh = job.voiceInboundPlaceholderRawBody?.trim();
    const msgId = job.ghlInboundMessageId?.trim();
    const noMediaUrl = !(job.audioMediaUrl ?? '').trim();

    if (
      fetchRecordingEnabled &&
      noMediaUrl &&
      msgId &&
      rawPh &&
      classifyGhlAudioPlaceholderBody(rawPh) !== 'UNKNOWN'
    ) {
      const fetched = await this.ghlVoiceRecordingFetch.tryFetchRecording({
        tenantId,
        locationId,
        messageId: msgId,
      });
      if (fetched.ok) {
        const tx = await this.audioTranscription.transcribeAudioBuffer({
          tenantId,
          buffer: fetched.buffer,
          contentType: fetched.contentType,
          conversationId,
          webhookEventId,
          sourceLabel: 'ghl_recording_api',
        });
        if (tx.ok) {
          return {
            content: tx.transcript,
            persistContentType: 'text',
            voiceMetadata: {
              inboundVoiceNote: true,
              voiceTranscriptionStatus: 'succeeded',
              voiceRecordingFetchedFromGhl: true,
              voiceMediaBytes: tx.mediaBytes,
              voiceMediaContentType: tx.contentType,
            },
          };
        }
      }
    }

    if (job.voiceInboundAudioPlaceholderWithoutMediaUrl) {
      return {
        content: job.messageContent,
        persistContentType: 'text',
        voiceMetadata: {
          inboundVoiceNote: true,
          voiceInboundAudioPlaceholderWithoutMediaUrl: true,
          voiceTranscriptionStatus: 'media_url_missing',
        },
      };
    }

    if (!job.voiceInboundNeedsTranscribe) {
      return {
        content: job.messageContent,
        persistContentType: job.messageType,
        voiceMetadata: {},
      };
    }

    const url = (job.audioMediaUrl ?? '').trim();
    const caption = String(job.messageContent ?? '').trim();

    if (!url) {
      this.logger.warn(
        `audioTranscriptionFailed ${JSON.stringify({
          tenantId,
          conversationId,
          webhookEventId: webhookEventId ?? null,
          errorCode: 'missing_media_url',
        })}`,
      );
      return {
        content: VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
        persistContentType: 'text',
        voiceMetadata: {
          inboundVoiceNote: true,
          voiceTranscriptionStatus: 'missing_media_url',
        },
      };
    }

    let mediaHost: string | null = null;
    try {
      mediaHost = new URL(url).hostname;
    } catch {
      mediaHost = null;
    }

    const tx = await this.audioTranscription.transcribeRemoteMedia({
      tenantId,
      mediaUrl: url,
      conversationId,
      webhookEventId,
    });

    if (tx.ok) {
      const combined = caption ? `${tx.transcript}\n\n${caption}` : tx.transcript;
      return {
        content: combined,
        persistContentType: 'text',
        voiceMetadata: {
          inboundVoiceNote: true,
          voiceTranscriptionStatus: 'succeeded',
          voiceOriginalMediaHost: mediaHost,
          voiceMediaBytes: tx.mediaBytes,
          voiceMediaContentType: tx.contentType,
        },
      };
    }

    return {
      content: VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
      persistContentType: 'text',
      voiceMetadata: {
        inboundVoiceNote: true,
        voiceTranscriptionStatus: 'failed',
        voiceOriginalMediaHost: mediaHost,
      },
    };
  }

  private async runOrchestrationAfterDebounce(job: Job<OrchestrateDebouncedJobData>): Promise<void> {
    const {
      tenantId,
      conversationId,
      locationId,
      ghlContactId,
      ghlConversationId,
      debounceVersion,
      webhookEventId,
      contactDisplayName,
      contactPhone,
      contactEmail,
      contactFieldsFromExtendedWebhook,
    } = job.data;

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
    const combinedText = recentBatch.join('\n\n').trim();
    this.logger.log(
      `Debounce processing batch: conversationId=${conversationId}, inboundBatchCount=${recentBatch.length}, ` +
        `uniqueProviderMessageCount=${new Set(recentBatch).size}, latestIntent=${latestIntent}, ` +
        `orderedMessagesPreview=${JSON.stringify(recentBatch.map(t => t.slice(0, 100)))} ` +
        `combinedTextPreviewLen=${combinedText.length}`,
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
      contactDisplayName,
      contactPhone,
      contactEmail,
      contactFieldsFromExtendedWebhook,
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
    contactDisplayName?: string;
    contactPhone?: string;
    contactEmail?: string;
    contactFieldsFromExtendedWebhook?: boolean;
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
      contactDisplayName,
      contactPhone,
      contactEmail,
      contactFieldsFromExtendedWebhook,
    } = ctx;

    if (
      await this.tryHandleChatResetCommand({
        tenantId,
        conversationId,
        locationId,
        ghlContactId,
        latestInboundText,
        recentInboundBatch,
      })
    ) {
      this.logger.log(`Orchestration skipped (chat reset command): conversationId=${conversationId}`);
      return;
    }

    const messageTextForTags =
      recentInboundBatch && recentInboundBatch.length > 0
        ? recentInboundBatch.join('\n\n').trim()
        : String(latestInboundText ?? '').trim();

    try {
      await this.inboundAutoTagging.evaluateAndApplyAutoTags({
        tenantId,
        conversationId,
        contactId: ghlContactId,
        ghlLocationId: locationId,
        messageText: messageTextForTags,
      });
    } catch (e) {
      this.logger.error(
        `Inbound auto-tagging threw (should not): ${e instanceof Error ? e.message : String(e)} — continuing to orchestration`,
      );
    }

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
      contactDisplayName: contactDisplayName?.trim() || null,
      contactPhone: contactPhone?.trim() || null,
      contactEmail: contactEmail?.trim() || null,
      contactFieldsFromExtendedWebhook: contactFieldsFromExtendedWebhook ?? null,
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

  /**
   * Exact `/new` (etc.) commands: clear policy state + memory anchor; enqueue confirmation only (no AI).
   * Uses the latest message in the debounced ordered batch (trimmed), not AI classification.
   */
  private async tryHandleChatResetCommand(params: {
    tenantId: string;
    conversationId: string;
    locationId: string;
    ghlContactId: string;
    latestInboundText: string;
    recentInboundBatch?: string[];
  }): Promise<boolean> {
    const latestTrimmed =
      params.recentInboundBatch && params.recentInboundBatch.length > 0
        ? String(params.recentInboundBatch[params.recentInboundBatch.length - 1] ?? '').trim()
        : String(params.latestInboundText ?? '').trim();

    const cmd = matchChatResetCommand(latestTrimmed);
    if (!cmd) return false;

    const eligibility = await this.conversationResetService.evaluateChatResetEligibility(
      params.tenantId,
      params.ghlContactId,
    );

    this.logger.log(
      `chatResetCommandDetected: ${JSON.stringify({
        conversationId: params.conversationId,
        tenantId: params.tenantId,
        command: cmd,
        allowEnvValue: eligibility.allowEnvValue ?? null,
        tenantSettingValue: eligibility.tenantSettingValue,
        whitelistConfigured: eligibility.whitelistConfigured,
        contactMatchedWhitelist: eligibility.contactMatchedWhitelist,
        allowed: eligibility.allowed,
        deniedReason: eligibility.deniedReason ?? null,
      })}`,
    );

    if (!eligibility.allowed) {
      this.logger.log(
        `chatResetCommandDenied: ${JSON.stringify({
          conversationId: params.conversationId,
          tenantId: params.tenantId,
          command: cmd,
          deniedReason: eligibility.deniedReason ?? 'unknown',
        })}`,
      );
      return false;
    }

    await this.conversationResetService.performBotStateReset({
      conversationId: params.conversationId,
      tenantId: params.tenantId,
      source: 'chat_command',
      resetCommand: cmd,
    });

    await this.conversationResetService.clearHandoverAfterAllowedReset(params.conversationId, params.tenantId);

    const plan = this.conversationResetService.buildConfirmationReplyPlan();
    await this.sendBubbleQueue.add('send-bubble', {
      conversationId: params.conversationId,
      tenantId: params.tenantId,
      contactId: params.ghlContactId,
      ghlLocationId: params.locationId,
      replyPlanJson: JSON.stringify(plan),
    });

    this.logger.log(
      `chatResetCommandHandled: ${JSON.stringify({
        conversationId: params.conversationId,
        tenantId: params.tenantId,
        command: cmd,
        resetSource: 'chat_command',
      })}`,
    );
    return true;
  }

  private async fetchRecentInboundBatch(conversationId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('content, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error || !data?.length) return [];
    return filterInboundRowsToBurstWindow(data as { created_at: string; content?: string | null }[]);
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
