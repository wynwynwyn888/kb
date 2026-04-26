// Inbound Message Processor
// Processes incoming messages from GHL webhooks:
// 1. Validates and loads tenant/conversation context
// 2. Persists inbound message to DB
// 3. Calls ConversationOrchestrationService for guard + routing
// 4. Updates webhook event status based on orchestration outcome
// Does NOT send outbound message — that is a later layer's responsibility.

import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { QUEUES } from '../queue.constants';
import { ConversationOrchestrationService } from '../../modules/orchestration/orchestration.service';
import type { NormalizedWebhookPayload } from '../../modules/webhooks/dto/ghl-webhook.payload';

export interface InboundMessageJobData {
  locationId: string;
  ghlConversationId: string;
  ghlContactId: string;
  messageContent: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  timestamp: string;
  webhookEventId?: string;
}

@Processor(QUEUES.INBOUND_MESSAGE_PROCESSOR)
@Injectable()
export class InboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundMessageProcessor.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly orchestrationService: ConversationOrchestrationService,
    @InjectQueue(QUEUES.SEND_BUBBLE) private readonly sendBubbleQueue: any,
  ) {
    super();
  }

  async process(job: Job<InboundMessageJobData>): Promise<void> {
    const {
      locationId,
      ghlConversationId,
      ghlContactId,
      messageContent,
      messageType,
      timestamp,
      webhookEventId,
    } = job.data;

    this.logger.log(
      `Processing inbound message: conversationId=${ghlConversationId}, type=${messageType}`,
    );

    // Update webhook event status to PROCESSING
    if (webhookEventId) {
      await this.updateWebhookEventStatus(webhookEventId, 'PROCESSING');
    }

    try {
      // Step 1: Load tenant by locationId
      const tenant = await this.findTenantByLocationId(locationId);
      if (!tenant) {
        throw new Error(`Tenant not found for locationId: ${locationId}`);
      }

      // Step 2: Get or create conversation (upsert by ghlConversationId)
      const conversation = await this.getOrCreateConversation(
        tenant.id,
        ghlConversationId,
        ghlContactId,
        timestamp,
      );

      // Step 3: Store inbound message
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

      this.logger.log(
        `Message stored: conversationId=${conversation.id}, messageType=${messageType}`,
      );

      // Step 4: Build normalized payload for orchestration
      const normalizedPayload: NormalizedWebhookPayload = {
        ghlLocationId: locationId,
        ghlConversationId,
        ghlContactId,
        messageContent,
        messageType,
        timestamp,
        externalEventId: webhookEventId ?? `local:${conversation.id}:${timestamp}`,
        eventType: 'inbound_message',
        dedupeKey: `proc:${conversation.id}:${timestamp}`,
        channelRaw: null,
      };

      // Step 5: Load tenant context
      const tenantContext = await this.orchestrationService.loadTenantContext(tenant.id);
      const promptConfig = await this.orchestrationService.loadPromptConfig(tenant.id);
      const agencyPolicy = await this.orchestrationService.loadAgencyPolicy(tenant.id);
      const conversationRecord = await this.orchestrationService.loadConversation(conversation.id);

      // Step 6: Build orchestration input
      const orchestrationInput = {
        tenantId: tenant.id,
        conversationId: conversation.id,
        webhookEventId,
        incomingMessage: normalizedPayload,
        tenant: tenantContext ?? undefined,
        promptConfig: promptConfig ?? undefined,
        agencyPolicy: agencyPolicy ?? undefined,
        conversation: conversationRecord ?? undefined,
      };

      // Step 7: Run full orchestration pipeline (guards + memory + routing)
      const result = await this.orchestrationService.orchestrate(orchestrationInput);

      // Step 8: Enqueue send-bubble job if orchestration produced reply bubbles (not in "suggestive" mode)
      if (result.outcome === 'PROCEED' && result.replyPlan && result.replyPlan.bubbles.length > 0) {
        const mode = tenantContext?.botMode ?? 'autopilot';
        if (mode === 'suggestive') {
          this.logger.log(
            `Suggestive mode: skipping GHL send for conversationId=${conversation.id} (drafts in orchestration log)`,
          );
        } else {
          await this.sendBubbleQueue.add('send-bubble', {
            conversationId: conversation.id,
            tenantId: tenant.id,
            contactId: ghlContactId,
            ghlLocationId: locationId,
            replyPlanJson: JSON.stringify(result.replyPlan),
          });

          this.logger.log(
            `Send-bubble job enqueued: conversationId=${conversation.id}, ` +
            `bubbleCount=${result.replyPlan.bubbles.length}`,
          );
        }
      }

      // Step 9: Update webhook event based on orchestration outcome
      if (webhookEventId) {
        if (result.outcome === 'PROCEED') {
          await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
        } else {
          await this.updateWebhookEventStatus(
            webhookEventId,
            'COMPLETED', // Mark completed even when skipped (not FAILED)
            `Orchestration outcome: ${result.outcome}; ${result.error ?? ''}`,
          );
        }
      }

      this.logger.log(
        `Orchestration result: conversationId=${conversation.id}, outcome=${result.outcome}, model=${result.routing?.recommendedModel ?? 'n/a'}`,
      );
    } catch (error) {
      const message = formatPostgrestError(error);
      this.logger.error(`Failed to process inbound message: ${message}`);

      if (webhookEventId) {
        await this.updateWebhookEventStatus(
          webhookEventId,
          'FAILED',
          message,
        );
      }

      throw error;
    }
  }

  private async findTenantByLocationId(
    locationId: string,
  ): Promise<{ id: string } | null> {
    const { data } = await this.supabase
      .from('tenants')
      .select('id')
      .eq('ghl_location_id', locationId)
      .single();

    return data;
  }

  /**
   * Upsert conversation:
   * - If ghlConversationId is present and non-empty: upsert by (tenantId, ghlConversationId)
   * - If missing: use provisional ID = "prov:{contactId}:{timestamp}" and store in metadata
   */
  private async getOrCreateConversation(
    tenantId: string,
    ghlConversationId: string,
    contactId: string,
    timestamp: string,
  ): Promise<{ id: string }> {
    if (ghlConversationId && ghlConversationId.trim() !== '') {
      const { data: existing } = await this.supabase
        .from('conversations')
        .select('id')
        .eq('ghl_conversation_id', ghlConversationId)
        .single();

      if (existing) {
        return existing;
      }

      const now = new Date().toISOString();
      const { data, error } = await this.supabase
        .from('conversations')
        .insert({
          id: randomUUID(),
          tenant_id: tenantId,
          ghl_conversation_id: ghlConversationId,
          contact_id: contactId,
          channel: 'WHATSAPP',
          status: 'ACTIVE',
          last_message_at: now,
          updated_at: now,
        })
        .select('id')
        .single();

      if (error || !data) {
        throw new Error(
          `Failed to create conversation: ${formatPostgrestError(error)}`,
        );
      }

      return data;
    }

    // Provisional fallback — no stable conversation ID
    const provisionalGhlConversationId = `prov:${contactId}:${timestamp}`;

    this.logger.warn(
      `Conversation created with provisional ID for tenant=${tenantId}, contactId=${contactId}`,
    );

    const { data: existing } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_conversation_id', provisionalGhlConversationId)
      .single();

    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('conversations')
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        ghl_conversation_id: provisionalGhlConversationId,
        contact_id: contactId,
        channel: 'WHATSAPP',
        status: 'ACTIVE',
        last_message_at: now,
        updated_at: now,
        metadata: {
          provisional: true,
          provisionalKey: `prov:${contactId}`,
          originalTimestamp: timestamp,
        },
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to create provisional conversation: ${formatPostgrestError(error)}`,
      );
    }

    return data;
  }

  /**
   * Maps GHL/normalized message type labels to Postgres `ContentType` enum (Prisma `Message.contentType` → DB column `"contentType"`).
   */
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

  /** `webhookEventRowId` is `webhook_events.id` (UUID), not `external_event_id`. */
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

    const { error } = await this.supabase
      .from('webhook_events')
      .update(updateData)
      .eq('id', webhookEventRowId);

    if (error) {
      this.logger.warn(
        `Webhook event status update failed (id=${webhookEventRowId}): ${formatPostgrestError(error)}`,
      );
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Inbound message job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Inbound message job ${job.id} failed: ${formatPostgrestError(error)}`,
    );
  }
}
