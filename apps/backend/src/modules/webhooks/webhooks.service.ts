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
  type GhlAudioPlaceholderKind,
  collectGhlInboundMediaRootNodes,
  extractGhlInboundAudioMediaUrl,
  extractGhlInboundMessageBodyString,
  resolveGhlAudioPlaceholderFromInbound,
  bodyPlaceholderCandidateShapeForLog,
  ghlInboundShouldTranscribeVoice,
  VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
} from './ghl-inbound-audio-media';
import { extractGhlInboundImageMediaUrl } from './ghl-inbound-image-media';
import { INBOUND_IMAGE_PLACEHOLDER_CONTENT } from '../../lib/inbound-image';
import { safeTextPreviewForLog } from '../../lib/safe-text-preview-for-log';
import { resolveInboundGhlWebhookTenant } from './ghl-inbound-webhook-tenant-resolution';
import { ghlWebhookShapeDiagnosticsEnabled } from '../../lib/production-log-flags';

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
    opts?: { smokeImmediate?: boolean; workflowFlatRaw?: Record<string, unknown> },
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

    const route = await resolveInboundGhlWebhookTenant({
      supabase: this.supabase,
      locationId: payload.locationId,
      logger: this.logger,
    });

    if (!route.ok) {
      if (route.reason === 'duplicate_crm_location') {
        return { success: true, duplicate: false };
      }
      this.logger.warn(
        `Webhook skipped: no CONNECTED workspace for locationId=${payload.locationId} ` +
          `(routing uses tenant_ghl_connections + bot_enabled + handover_paused; legacy tenants.ghl_location_id fallback only when unambiguous).`,
      );
      return { success: true, duplicate: false };
    }

    if (route.routeSource === 'tenant_ghl_connection') {
      const legacy = (route.tenantLegacyGhlLocationId ?? '').trim();
      const conn = (route.connectionLocationId ?? '').trim();
      if (legacy.length > 0 && legacy !== conn) {
        this.logger.warn(
          `CRM location drift tenantId=${route.tenantId} locationId=${payload.locationId} ` +
            `tenantLegacyLocationId=${legacy} connectionLocationId=${conn || '(empty)'}`,
        );
      }
    }

    // Check for duplicate event
    const existingEvent = await this.findExistingEvent(
      route.tenantId,
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
    const normalizedPayload = this.normalizeInboundConversationMessage(
      payload,
      externalEventId,
      dedupeKey,
      opts?.workflowFlatRaw,
    );

    // Persist webhook event
    const webhookEvent = await this.persistWebhookEvent(
      route.tenantId,
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
      resolvedTenantId: route.tenantId,
      workflowFlatRaw: opts?.workflowFlatRaw,
    });

    this.logger.log(
      `Webhook processed: eventId=${webhookEvent.id}, locationId=${payload.locationId}, eventType=${payload.event}`,
    );

    return { success: true, eventId: webhookEvent.id, duplicate: false };
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
   * Normalize GHL payload to internal format (inbound conversation messages).
   */
  private normalizeInboundConversationMessage(
    payload: GhlWebhookPayload,
    externalEventId: string,
    dedupeKey: string,
    workflowFlatRaw?: Record<string, unknown>,
  ): NormalizedWebhookPayload {
    const data = (payload.data || {}) as unknown as Record<string, unknown>;
    const extracted = extractInboundContactFields(data, workflowFlatRaw);
    const envelope = payload as unknown as Record<string, unknown>;

    const rawMessageBody =
      extractGhlInboundMessageBodyString(data) ||
      (typeof data['body'] === 'string' ? data['body'] : '');

    const placeholderResolved = resolveGhlAudioPlaceholderFromInbound(data, workflowFlatRaw);
    const bodyPlaceholderKind: GhlAudioPlaceholderKind = placeholderResolved.kind;
    const isAudioPlaceholderInbound = bodyPlaceholderKind !== 'UNKNOWN';

    const rawMessageType =
      typeof data['messageType'] === 'string' ? data['messageType'] : undefined;
    const messageTypeMapped = this.mapMessageType(rawMessageType);

    const audioMediaUrl = extractGhlInboundAudioMediaUrl(data, {
      envelope,
      workflowFlatRaw,
    });

    const imageMediaUrl = extractGhlInboundImageMediaUrl(data, {
      envelope,
      workflowFlatRaw,
    });

    const voiceInboundAudioPlaceholderWithoutMediaUrl = isAudioPlaceholderInbound && !audioMediaUrl;

    let messageContent = rawMessageBody;
    let messageType = messageTypeMapped;
    if (voiceInboundAudioPlaceholderWithoutMediaUrl) {
      messageContent = VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE;
      messageType = 'text';
    } else if (messageTypeMapped === 'image' || imageMediaUrl) {
      messageType = 'image';
      if (!messageContent.trim()) {
        messageContent = INBOUND_IMAGE_PLACEHOLDER_CONTENT;
      }
    }

    const voiceInboundNeedsTranscribe = voiceInboundAudioPlaceholderWithoutMediaUrl
      ? false
      : ghlInboundShouldTranscribeVoice({
          messageType: messageTypeMapped,
          messageContent: rawMessageBody,
          audioMediaUrl,
          rawData: data,
          envelope,
          workflowFlatRaw,
        });

    const evNorm = (payload.event || '').trim().toLowerCase();
    const runInboundShapeDiagnostics =
      evNorm === 'conversation_message_created' || evNorm === 'inboundmessage';

    const bodyPlaceholderCandidateShape = bodyPlaceholderCandidateShapeForLog(
      placeholderResolved.shapeSourceRaw,
    );

    if (runInboundShapeDiagnostics && ghlWebhookShapeDiagnosticsEnabled()) {
      this.logGhlInboundNormalizeDiagnostics(payload, data, envelope, workflowFlatRaw, {
        rawMessageType: rawMessageType ?? null,
        mappedMessageType: messageType,
        messageBodyPreview: JSON.stringify(
          safeTextPreviewForLog(this.redactInboundUrlsForLog(rawMessageBody, 240), {
            hashSalt: 'ghlMessageBody',
          }),
        ),
        audioMediaUrlForShape: audioMediaUrl,
        voiceInboundNeedsTranscribe,
        voiceInboundAudioPlaceholderWithoutMediaUrl,
        bodyPlaceholderKind,
        bodyPlaceholderCandidateShape,
      });
    }

    if (runInboundShapeDiagnostics && voiceInboundAudioPlaceholderWithoutMediaUrl) {
      this.logger.log(
        JSON.stringify({
          voiceInboundAudioPlaceholderWithoutMediaUrl: true,
          bodyPlaceholderKind,
        }),
      );
    }

    const ghlInboundMessageId =
      typeof data['id'] === 'string' && data['id'].trim() ? data['id'].trim() : undefined;

    return {
      ghlLocationId: payload.locationId,
      ghlConversationId: (typeof data['conversationId'] === 'string' && data['conversationId']) || '',
      ghlContactId: (typeof data['contactId'] === 'string' && data['contactId']) || '',
      messageContent,
      messageType,
      audioMediaUrl: audioMediaUrl ?? null,
      imageMediaUrl: imageMediaUrl ?? null,
      voiceInboundNeedsTranscribe,
      voiceInboundAudioPlaceholderWithoutMediaUrl,
      voiceInboundPlaceholderKind: isAudioPlaceholderInbound ? bodyPlaceholderKind : undefined,
      voiceInboundPlaceholderRawBody: voiceInboundAudioPlaceholderWithoutMediaUrl
        ? placeholderResolved.matchedRawBody ?? undefined
        : undefined,
      ghlInboundMessageId,
      timestamp: payload.timestamp || new Date().toISOString(),
      externalEventId,
      eventType: payload.event,
      dedupeKey,
      channelRaw: (typeof data['channel'] === 'string' && data['channel']) || null,
      ghlMessageTypeRaw: rawMessageType ?? null,
      contactFieldsFromExtendedWebhook: extracted.fromExtendedWebhookKeys,
      contactDisplayName: extracted.displayName,
      contactPhone: extracted.phone,
      contactEmail: extracted.email,
    };
  }

  private redactInboundUrlsForLog(text: string, maxLen: number): string {
    return text
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted_url]')
      .replace(/\bsk-[a-zA-Z0-9_-]{10,}\b/gi, '[redacted_token]')
      .slice(0, maxLen);
  }

  private inboundUrlShapeMeta(raw: string | null): { host: string; pathLen: number } | null {
    if (!raw?.trim()) return null;
    try {
      const u = new URL(raw.trim());
      return { host: u.hostname, pathLen: u.pathname.length };
    } catch {
      return { host: 'unparsed', pathLen: Math.min(raw.trim().length, 80) };
    }
  }

  private logGhlInboundNormalizeDiagnostics(
    payload: GhlWebhookPayload,
    data: Record<string, unknown>,
    envelope: Record<string, unknown>,
    workflowFlatRaw: Record<string, unknown> | undefined,
    ctx: {
      rawMessageType: string | null;
      mappedMessageType: string;
      messageBodyPreview: string;
      audioMediaUrlForShape: string | null;
      voiceInboundNeedsTranscribe: boolean;
      voiceInboundAudioPlaceholderWithoutMediaUrl: boolean;
      bodyPlaceholderKind: GhlAudioPlaceholderKind;
      bodyPlaceholderCandidateShape: ReturnType<typeof bodyPlaceholderCandidateShapeForLog>;
    },
  ): void {
    const msgRaw = data['message'];
    const messageKeys =
      msgRaw && typeof msgRaw === 'object' && !Array.isArray(msgRaw)
        ? Object.keys(msgRaw as Record<string, unknown>).slice(0, 40)
        : [];

    const flat = workflowFlatRaw;
    const customDataKeys =
      flat &&
      flat['customData'] &&
      typeof flat['customData'] === 'object' &&
      !Array.isArray(flat['customData'])
        ? Object.keys(flat['customData'] as Record<string, unknown>).slice(0, 40)
        : [];
    const workflowFlatDataKeys =
      flat &&
      flat['data'] &&
      typeof flat['data'] === 'object' &&
      !Array.isArray(flat['data'])
        ? Object.keys(flat['data'] as Record<string, unknown>).slice(0, 40)
        : [];
    const flatMsg = flat?.['message'];
    const workflowFlatMessageKeys =
      flatMsg && typeof flatMsg === 'object' && !Array.isArray(flatMsg)
        ? Object.keys(flatMsg as Record<string, unknown>).slice(0, 40)
        : [];

    let attachmentCount = 0;
    let mediaKeyedNodeCount = 0;
    let attachmentItemKeysSample: string[] = [];
    let mediaItemKeysSample: string[] = [];

    const roots = collectGhlInboundMediaRootNodes(data, envelope, workflowFlatRaw);
    for (const node of roots) {
      const att = node['attachments'];
      if (Array.isArray(att)) {
        attachmentCount += att.length;
        if (!attachmentItemKeysSample.length) {
          const first = att[0];
          if (first && typeof first === 'object' && !Array.isArray(first)) {
            attachmentItemKeysSample = Object.keys(first as Record<string, unknown>).slice(0, 30);
          }
        }
      }
      const med = node['media'];
      if (med != null && typeof med === 'object') {
        mediaKeyedNodeCount++;
        if (!mediaItemKeysSample.length) {
          if (Array.isArray(med)) {
            const m0 = med[0];
            if (m0 && typeof m0 === 'object' && !Array.isArray(m0)) {
              mediaItemKeysSample = Object.keys(m0 as Record<string, unknown>).slice(0, 30);
            }
          } else {
            mediaItemKeysSample = Object.keys(med as Record<string, unknown>).slice(0, 30);
          }
        }
      }
    }

    const topLevelKeys = flat ? Object.keys(flat).slice(0, 40) : Object.keys(envelope).slice(0, 40);
    const dataKeys = Object.keys(data).slice(0, 40);

    this.logger.log(
      JSON.stringify({
        ghlInboundShapeDiagnostics: true,
        eventType: payload.event,
        messageType: ctx.rawMessageType,
        mappedMessageType: ctx.mappedMessageType,
        messageBodyPreview: ctx.messageBodyPreview,
        attachmentCount,
        mediaKeyedNodeCount,
        topLevelKeys,
        dataKeys,
        customDataKeys,
        workflowFlatDataKeys,
        messageKeys,
        workflowFlatMessageKeys,
        attachmentItemKeysSample,
        mediaItemKeysSample,
        audioMediaUrlShape: this.inboundUrlShapeMeta(ctx.audioMediaUrlForShape),
        voiceInboundNeedsTranscribe: ctx.voiceInboundNeedsTranscribe,
        voiceInboundAudioPlaceholderWithoutMediaUrl: ctx.voiceInboundAudioPlaceholderWithoutMediaUrl,
        bodyPlaceholderKind: ctx.bodyPlaceholderKind,
        bodyPlaceholderCandidateShape: ctx.bodyPlaceholderCandidateShape,
      }),
    );
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
      voice: 'audio',
      VoiceMessage: 'audio',
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
    opts?: {
      smokeImmediate?: boolean;
      resolvedTenantId?: string;
      workflowFlatRaw?: Record<string, unknown>;
    },
  ): Promise<void> {
    const jobData: InboundMessageJobData = {
      resolvedTenantId: opts?.resolvedTenantId,
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
      imageMediaUrl: payload.imageMediaUrl ?? undefined,
      voiceInboundNeedsTranscribe: Boolean(payload.voiceInboundNeedsTranscribe),
      voiceInboundAudioPlaceholderWithoutMediaUrl: Boolean(
        payload.voiceInboundAudioPlaceholderWithoutMediaUrl,
      ),
      voiceInboundPlaceholderRawBody: payload.voiceInboundPlaceholderRawBody,
      voiceInboundPlaceholderKind: payload.voiceInboundPlaceholderKind,
      ghlInboundMessageId: payload.ghlInboundMessageId,
      channelRaw: payload.channelRaw ?? undefined,
      ghlMessageTypeRaw: payload.ghlMessageTypeRaw ?? undefined,
      workflowFlatRaw: opts?.workflowFlatRaw,
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
