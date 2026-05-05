// Webhooks service - processes incoming GHL webhooks

import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { getSupabaseService } from '../../lib/supabase';
import { QUEUES } from '../../queues/queue.constants';
import { InboundMessageJobData } from '../../queues/processors/inbound-message.processor';
import {
  GhlWebhookPayload,
  NormalizedWebhookPayload,
} from './dto/ghl-webhook.payload';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { extractGhlInboundDedupeKeys } from './ghl-webhook-dedupe';
import { extractInboundContactFields } from './ghl-inbound-contact-extract';
import {
  extractGhlInboundAudioMediaUrl,
  ghlInboundShouldTranscribeVoice,
} from './ghl-inbound-audio-media';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.INBOUND_MESSAGE_PROCESSOR)
    private readonly inboundQueue: Queue,
  ) {}

  /**
   * Main entry point for incoming GHL webhooks
   * Returns fast to acknowledge receipt
   */
  async handleGhlWebhook(
    payload: GhlWebhookPayload,
    opts?: { smokeImmediate?: boolean },
  ): Promise<{
    success: boolean;
    eventId?: string;
    duplicate?: boolean;
    /** When duplicate=true: why the skip matched (never `text_only` — body-only dedupe is not used). */
    duplicateReason?: 'provider_event_id' | 'provider_payload_hash';
  }> {
    // Validate required top-level fields
    if (!payload.locationId || !payload.event) {
      throw new BadRequestException(
        'Invalid webhook payload: missing locationId or event',
      );
    }

    const { externalEventId, dedupeKey, dedupeReason } = extractGhlInboundDedupeKeys(payload);

    // Identify tenant and verify active connection
    const tenantConnection = await this.findTenantByLocationId(
      payload.locationId,
    );

    // Unregistered or non-connected location: acknowledge, skip processing
    if (!tenantConnection) {
      this.logger.warn(
        `Webhook received for unregistered or inactive location: ${payload.locationId}`,
      );
      return { success: true, duplicate: false };
    }

    // Check for duplicate event
    const existingEvent = await this.findExistingEvent(
      tenantConnection.tenantId,
      externalEventId,
    );

    if (existingEvent) {
      this.logger.log(
        `duplicateWebhookSkipped=true duplicateReason=${dedupeReason} externalEventId=${JSON.stringify(String(externalEventId).slice(0, 120))}`,
      );
      return {
        success: true,
        eventId: existingEvent.id,
        duplicate: true,
        duplicateReason: dedupeReason,
      };
    }

    // Normalize payload to internal shape
    const normalizedPayload = this.normalizePayload(
      payload,
      externalEventId,
      dedupeKey,
    );

    // Persist webhook event
    const webhookEvent = await this.persistWebhookEvent(
      tenantConnection.tenantId,
      {
        externalEventId,
        dedupeKey,
        eventType: payload.event,
        rawPayloadJson: payload as unknown as Record<string, unknown>,
        normalizedPayloadJson:
          normalizedPayload as unknown as Record<string, unknown>,
        processingStatus: 'RECEIVED',
      },
    );

    // Enqueue for async processing
    await this.enqueueInboundMessage(normalizedPayload, webhookEvent.id, {
      smokeImmediate: Boolean(opts?.smokeImmediate),
    });

    this.logger.log(
      `Webhook processed: eventId=${webhookEvent.id}, locationId=${payload.locationId}, eventType=${payload.event}`,
    );

    return { success: true, eventId: webhookEvent.id, duplicate: false };
  }

  /**
   * Find tenant by GHL location ID and verify connection is CONNECTED
   */
  private async findTenantByLocationId(
    locationId: string,
  ): Promise<{ tenantId: string; status: string } | null> {
    // Find tenant by location
    const { data: tenant, error: tenantError } = await this.supabase
      .from('tenants')
      .select('id')
      .eq('ghl_location_id', locationId)
      .single();

    if (tenantError || !tenant) {
      return null;
    }

    // Check connection status
    const { data: connection, error: connError } = await this.supabase
      .from('tenant_ghl_connections')
      .select('tenant_id, status')
      .eq('tenant_id', tenant.id)
      .eq('ghl_location_id', locationId)
      .single();

    if (connError || !connection) {
      return null;
    }

    if (connection.status !== 'CONNECTED') {
      return null;
    }

    return {
      tenantId: connection.tenant_id,
      status: connection.status,
    };
  }

  /**
   * Check if event already exists (dedupe check)
   */
  private async findExistingEvent(
    tenantId: string,
    externalEventId: string,
  ): Promise<{ id: string } | null> {
    const { data } = await this.supabase
      .from('webhook_events')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('external_event_id', externalEventId)
      .single();

    return data;
  }

  /**
   * Normalize GHL payload to internal format
   */
  private normalizePayload(
    payload: GhlWebhookPayload,
    externalEventId: string,
    dedupeKey: string,
  ): NormalizedWebhookPayload {
    const data = (payload.data || {}) as unknown as Record<string, unknown>;
    const extracted = extractInboundContactFields(data);

    const messageContent = (typeof data['message'] === 'string' && data['message']) || '';
    const messageType = this.mapMessageType(typeof data['messageType'] === 'string' ? data['messageType'] : undefined);
    const audioMediaUrl = extractGhlInboundAudioMediaUrl(data);
    const voiceInboundNeedsTranscribe = ghlInboundShouldTranscribeVoice({
      messageType,
      messageContent,
      audioMediaUrl,
      rawData: data,
    });

    return {
      ghlLocationId: payload.locationId,
      ghlConversationId: (typeof data['conversationId'] === 'string' && data['conversationId']) || '',
      ghlContactId: (typeof data['contactId'] === 'string' && data['contactId']) || '',
      messageContent,
      messageType,
      audioMediaUrl: audioMediaUrl ?? null,
      voiceInboundNeedsTranscribe,
      timestamp: payload.timestamp || new Date().toISOString(),
      externalEventId,
      eventType: payload.event,
      dedupeKey,
      channelRaw: (typeof data['channel'] === 'string' && data['channel']) || null,
      contactFieldsFromExtendedWebhook: extracted.fromExtendedWebhookKeys,
      contactDisplayName: extracted.displayName,
      contactPhone: extracted.phone,
      contactEmail: extracted.email,
    };
  }

  /**
   * Map GHL message type to internal type
   */
  private mapMessageType(
    ghlType?: string,
  ): 'text' | 'image' | 'audio' | 'video' | 'unknown' {
    const typeMap: Record<
      string,
      'text' | 'image' | 'audio' | 'video' | 'unknown'
    > = {
      text: 'text',
      TextMessage: 'text',
      image: 'image',
      ImageMessage: 'image',
      video: 'video',
      VideoMessage: 'video',
      audio: 'audio',
      AudioMessage: 'audio',
    };

    return typeMap[ghlType || ''] || 'unknown';
  }

  /**
   * Persist webhook event to database
   */
  private async persistWebhookEvent(
    tenantId: string,
    data: {
      externalEventId: string;
      dedupeKey: string;
      eventType: string;
      rawPayloadJson: Record<string, unknown>;
      normalizedPayloadJson: Record<string, unknown>;
      processingStatus: string;
    },
  ): Promise<{ id: string }> {
    const { data: result, error } = await this.supabase
      .from('webhook_events')
      .insert({
        // Prisma schema uses @default(uuid()) at ORM layer; DB migration has no DEFAULT on id — must set for raw Supabase inserts.
        id: randomUUID(),
        tenant_id: tenantId,
        external_event_id: data.externalEventId,
        dedupe_key: data.dedupeKey,
        provider: 'GHL',
        event_type: data.eventType,
        raw_payload_json: data.rawPayloadJson,
        normalized_payload_json: data.normalizedPayloadJson,
        processing_status: data.processingStatus,
        received_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error(`Failed to persist webhook event: ${formatPostgrestError(error)}`);
      throw error;
    }

    return result;
  }

  /**
   * Enqueue inbound message for async processing
   */
  async enqueueInboundMessage(
    payload: NormalizedWebhookPayload,
    webhookEventId?: string,
    opts?: { smokeImmediate?: boolean },
  ): Promise<void> {
    const jobData: InboundMessageJobData = {
      locationId: payload.ghlLocationId,
      ghlConversationId: payload.ghlConversationId,
      ghlContactId: payload.ghlContactId,
      messageContent: payload.messageContent,
      messageType: payload.messageType as 'text' | 'image' | 'audio' | 'video' | 'unknown',
      timestamp: payload.timestamp,
      webhookEventId,
      smokeImmediate: Boolean(opts?.smokeImmediate),
      contactDisplayName: payload.contactDisplayName ?? undefined,
      contactPhone: payload.contactPhone ?? undefined,
      contactEmail: payload.contactEmail ?? undefined,
      contactFieldsFromExtendedWebhook: Boolean(payload.contactFieldsFromExtendedWebhook),
      audioMediaUrl: payload.audioMediaUrl ?? undefined,
      voiceInboundNeedsTranscribe: Boolean(payload.voiceInboundNeedsTranscribe),
    };

    await this.inboundQueue.add('persist', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: false,
      removeOnFail: false,
    });

    this.logger.debug(
      `Enqueued inbound message job: conversationId=${payload.ghlConversationId}`,
    );
  }
}
