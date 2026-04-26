// Webhooks service - processes incoming GHL webhooks

import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { getSupabaseService } from '../../lib/supabase';
import { QUEUES } from '../../queues/queue.constants';
import { InboundMessageJobData } from '../../queues/processors/inbound-message.processor';
import {
  GhlWebhookPayload,
  NormalizedWebhookPayload,
} from './dto/ghl-webhook.payload';

/** Supabase/PostgREST errors are plain objects; stringify for logs (avoid `[object Object]`). */
export function formatPostgrestError(err: unknown): string {
  if (err == null) return 'null';
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>;
    const msg = typeof o.message === 'string' ? o.message : '';
    const code = typeof o.code === 'string' ? o.code : '';
    const details = typeof o.details === 'string' ? o.details : '';
    const hint = typeof o.hint === 'string' ? o.hint : '';
    const parts = [
      msg,
      code ? `code=${code}` : '',
      details ? `details=${details}` : '',
      hint ? `hint=${hint}` : '',
    ].filter(Boolean);
    if (parts.length) return parts.join(' | ');
  }
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

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
  ): Promise<{ success: boolean; eventId?: string; duplicate?: boolean }> {
    // Validate required top-level fields
    if (!payload.locationId || !payload.event) {
      throw new BadRequestException(
        'Invalid webhook payload: missing locationId or event',
      );
    }

    // Extract dedupe key (Tier 1 → 2 → 3)
    const { externalEventId, dedupeKey } = this.extractDedupeKey(payload);

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
      this.logger.debug(
        `Duplicate webhook event detected: ${externalEventId}`,
      );
      return { success: true, eventId: existingEvent.id, duplicate: true };
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
    await this.enqueueInboundMessage(normalizedPayload, webhookEvent.id);

    this.logger.log(
      `Webhook processed: eventId=${webhookEvent.id}, locationId=${payload.locationId}, eventType=${payload.event}`,
    );

    return { success: true, eventId: webhookEvent.id, duplicate: false };
  }

  /**
   * Extract dedupe key using 3-tier strategy
   *
   * Tier 1: Use GHL's data.id directly (preferred)
   * Tier 2: Derive from provider + locationId + conversationId + eventType + timestamp
   *         (fallback if data.id missing; swap conversationId for contactId if needed)
   * Tier 3: SHA-256 hash of locationId + conversationId + message + messageType + timestamp
   *         (last resort when payload too sparse)
   */
  private extractDedupeKey(payload: GhlWebhookPayload): {
    externalEventId: string;
    dedupeKey: string;
  } {
    const data = payload.data || {};

    // Tier 1: GHL-provided message ID
    if (data.id) {
      return {
        externalEventId: data.id,
        dedupeKey: `tier1:${data.id}`,
      };
    }

    // Tier 2: Derived from stable fields
    const locationId = payload.locationId;
    const conversationId = data.conversationId;
    const contactId = data.contactId;
    const eventType = payload.event;
    const timestamp = payload.timestamp;

    if (conversationId) {
      const tier2Key = `GHL|${locationId}|${conversationId}|${eventType}|${timestamp}`;
      return {
        externalEventId: tier2Key,
        dedupeKey: `tier2:${tier2Key}`,
      };
    }

    if (contactId) {
      const tier2Key = `GHL|${locationId}|${contactId}|${eventType}|${timestamp}`;
      return {
        externalEventId: tier2Key,
        dedupeKey: `tier2:${tier2Key}`,
      };
    }

    // Tier 3: Hash of sparse payload content (last resort)
    const components = [
      locationId,
      conversationId || '',
      data.message || '',
      data.messageType || '',
      timestamp,
    ].join('|');

    const hash = createHash('sha256')
      .update(components)
      .digest('hex')
      .substring(0, 32);

    return {
      externalEventId: hash,
      dedupeKey: `tier3:${hash}`,
    };
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
    const data = payload.data || {};

    return {
      ghlLocationId: payload.locationId,
      ghlConversationId: data.conversationId || '',
      ghlContactId: data.contactId || '',
      messageContent: data.message || '',
      messageType: this.mapMessageType(data.messageType),
      timestamp: payload.timestamp || new Date().toISOString(),
      externalEventId,
      eventType: payload.event,
      dedupeKey,
      channelRaw: data.channel || null,
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
  ): Promise<void> {
    const jobData: InboundMessageJobData = {
      locationId: payload.ghlLocationId,
      ghlConversationId: payload.ghlConversationId,
      ghlContactId: payload.ghlContactId,
      messageContent: payload.messageContent,
      messageType: payload.messageType as 'text' | 'image' | 'audio' | 'video' | 'unknown',
      timestamp: payload.timestamp,
      webhookEventId,
    };

    await this.inboundQueue.add('process-inbound', jobData, {
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
