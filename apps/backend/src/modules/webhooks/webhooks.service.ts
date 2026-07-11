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
import {
  extractGhlInboundImageMediaUrl,
  ghlBodyIndicatesImagePlaceholder,
  ghlInboundHasAttachmentNodes,
  stripGhlImagePlaceholderFromInboundBody,
} from './ghl-inbound-image-media';
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
    /** When success=true but message was not enqueued (routing miss, duplicate CRM location, etc.). */
    skippedReason?: string;
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
        this.logger.error(
          `webhookRoutingFailed ${JSON.stringify({
            reason: route.reason,
            locationId: payload.locationId,
            duplicateTenantIds: route.duplicateTenantIds ?? [],
          })}`,
        );
        const auditTenantId = route.duplicateTenantIds?.[0];
        if (auditTenantId) {
          await this.persistSkippedWebhookEvent(auditTenantId, payload, externalEventId, dedupeKey, route.reason);
        }
        return { success: true, duplicate: false, skippedReason: 'duplicate_crm_location' };
      }
      if (route.auditTenantId) {
        await this.persistSkippedWebhookEvent(
          route.auditTenantId,
          payload,
          externalEventId,
          dedupeKey,
          route.reason,
        );
      }
      this.logger.warn(
        `webhookRoutingFailed ${JSON.stringify({
          reason: route.reason,
          locationId: payload.locationId,
          auditTenantId: route.auditTenantId ?? null,
        })}`,
      );
      return { success: true, duplicate: false, skippedReason: route.reason };
    }

    const tenantId = route.tenantId;

    // Route OutboundMessage events: record only, don't trigger AI
    const eventLower = (payload.event || '').trim().toLowerCase();
    if (eventLower === 'outboundmessage') {
      await this.handleOutboundMessageWebhook(payload, tenantId, externalEventId, dedupeKey);
      return { success: true, eventId: externalEventId, duplicate: false };
    }

    // Route TagAdded events: update conversation ai_status metadata
    // TagRemoved is not needed — next InboundMessage webhook sets active (GHL workflow
    // only fires Customer Replied when AI off tag is absent).
    if (eventLower === 'tagadded') {
      await this.handleTagEvent(payload, tenantId, eventLower, opts?.workflowFlatRaw);
      return { success: true, eventId: externalEventId, duplicate: false };
    }

    // --- Inbound message processing continues below ---
    // GHL Customer Replied workflow only fires when AI off tag is absent.
    // Set ai_status = "active" as an authoritative signal that AI is not off.
    void this.setContactAiStatusFromWebhook(tenantId, payload, opts?.workflowFlatRaw);

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
      messageBody: rawMessageBody,
    });

    const imagePlaceholderInBody = ghlBodyIndicatesImagePlaceholder(rawMessageBody);
    const attachmentNodesPresent = ghlInboundHasAttachmentNodes(data, envelope, workflowFlatRaw);

    const voiceInboundAudioPlaceholderWithoutMediaUrl = isAudioPlaceholderInbound && !audioMediaUrl;

    let messageContent = rawMessageBody;
    let messageType = messageTypeMapped;
    if (voiceInboundAudioPlaceholderWithoutMediaUrl) {
      messageContent = VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE;
      messageType = 'text';
    } else if (
      messageTypeMapped === 'image' ||
      imageMediaUrl ||
      imagePlaceholderInBody ||
      (attachmentNodesPresent && !audioMediaUrl && messageTypeMapped !== 'audio')
    ) {
      messageType = 'image';
      const stripped = stripGhlImagePlaceholderFromInboundBody(rawMessageBody);
      messageContent = stripped || INBOUND_IMAGE_PLACEHOLDER_CONTENT;
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
      (typeof data['id'] === 'string' && data['id'].trim() ? data['id'].trim() : undefined) ||
      (workflowFlatRaw &&
      typeof workflowFlatRaw['messageId'] === 'string' &&
      workflowFlatRaw['messageId'].trim()
        ? workflowFlatRaw['messageId'].trim()
        : undefined) ||
      (typeof envelope['messageId'] === 'string' && envelope['messageId'].trim()
        ? envelope['messageId'].trim()
        : undefined);

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

    return typeMap[ghlType || ''] || (ghlType?.toLowerCase().includes('image') ? 'image' : 'unknown');
  }

  /**
   * Persist webhook event to database
   */
  private async persistSkippedWebhookEvent(
    tenantId: string,
    payload: GhlWebhookPayload,
    externalEventId: string,
    dedupeKey: string,
    skipReason: string,
  ): Promise<void> {
    try {
      const { error } = await this.supabase.from('webhook_events').insert({
        id: randomUUID(),
        tenant_id: tenantId,
        external_event_id: externalEventId,
        dedupe_key: dedupeKey,
        provider: 'GHL',
        event_type: payload.event,
        raw_payload_json: payload as unknown as Record<string, unknown>,
        normalized_payload_json: { skippedReason: skipReason } as Record<string, unknown>,
        processing_status: 'SKIPPED',
        processing_error: skipReason,
        received_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      });
      if (error && !/23505|duplicate key|unique constraint/i.test(formatPostgrestError(error))) {
        this.logger.warn(
          `webhookSkippedPersistFailed ${JSON.stringify({
            tenantId,
            skipReason,
            message: formatPostgrestError(error),
          })}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `webhookSkippedPersistFailed ${JSON.stringify({
          tenantId,
          skipReason,
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
    }
  }

  /**
   * Handle GHL TagAdded event for "AI off" tag.
   * Sets conversation.metadata.ai_status = "off" for all contact conversations.
   * TagRemoved is not needed — the next InboundMessage webhook sets it back to "active"
   * (GHL Customer Replied workflow only fires when AI off tag is absent).
   */
  private async handleTagEvent(
    payload: GhlWebhookPayload,
    tenantId: string,
    _eventType: string,
    workflowFlatRaw?: Record<string, unknown>,
  ): Promise<void> {
    // Extract tag name from workflow flat body or payload data.
    // GHL workflow custom webhooks often nest fields under `customData`.
    const sources: Record<string, unknown>[] = [];
    if (workflowFlatRaw) {
      sources.push(workflowFlatRaw);
      const cd = workflowFlatRaw['customData'];
      if (cd && typeof cd === 'object' && !Array.isArray(cd)) {
        sources.push(cd as Record<string, unknown>);
      }
    }
    const dataRecord = payload.data ? payload.data : {};
    sources.push(dataRecord as unknown as Record<string, unknown>);
    sources.push(payload as unknown as Record<string, unknown>);

    const tagName = (() => {
      for (const src of sources) {
        for (const key of ['tag', 'tagName', 'tag_name', 'name', 'value', 'label']) {
          const v = src[key];
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
      }
      return null;
    })();

    if (!tagName || tagName.toLowerCase() !== 'ai off') {
      this.logger.log(
        `tag_event_skipped: tenantId=${tenantId} tagName=${tagName ?? 'NONE'}`,
      );
      return;
    }

    const contactId = (payload.data && typeof payload.data === 'object'
        ? (payload.data as unknown as Record<string, unknown>)['contactId'] as string
        : null)
      ?? (workflowFlatRaw?.['contactId'] as string)
      ?? (workflowFlatRaw?.['contact_id'] as string)
      ?? null;
    if (!contactId) {
      this.logger.warn(
        `tag_event_no_contact: tenantId=${tenantId} tagName=${tagName}`,
      );
      return;
    }

    await this.updateContactConversationsAiStatus(tenantId, contactId, 'off');
    this.logger.log(
      `tag_event_applied: tenantId=${tenantId} contactId=${contactId} aiStatus=off`,
    );
  }

  /**
   * Set ai_status on all conversations for a contact.
   * Best-effort: errors are logged but not thrown.
   */
  private async updateContactConversationsAiStatus(
    tenantId: string,
    contactId: string,
    status: string,
  ): Promise<void> {
    try {
      const { data: conversations } = await this.supabase
        .from('conversations')
        .select('id, metadata')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contactId);

      if (!conversations?.length) return;

      for (const conv of conversations) {
        const meta = (conv.metadata as Record<string, unknown>) ?? {};
        if (meta['ai_status'] === status) continue;

        meta['ai_status'] = status;
        meta['ai_status_updated_at'] = new Date().toISOString();
        await this.supabase
          .from('conversations')
          .update({ metadata: meta, updated_at: new Date().toISOString() })
          .eq('id', conv.id);
      }
    } catch (err) {
      this.logger.warn(
        `updateContactAiStatus_failed: tenantId=${tenantId} contactId=${contactId} status=${status} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * InboundMessage webhook: GHL's Customer Replied workflow only fires when AI off
   * tag is absent. Set ai_status = "active" as an authoritative signal.
   * Fire-and-forget — does not block webhook processing.
   */
  private async setContactAiStatusFromWebhook(
    tenantId: string,
    payload: GhlWebhookPayload,
    workflowFlatRaw?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const contactId = (payload.data && typeof payload.data === 'object'
          ? (payload.data as unknown as Record<string, unknown>)['contactId'] as string
          : null)
        ?? (workflowFlatRaw?.['contactId'] as string)
        ?? (workflowFlatRaw?.['contact_id'] as string)
        ?? null;

      if (!contactId) return;

      await this.updateContactConversationsAiStatus(tenantId, contactId, 'active');
    } catch (err) {
      // Best-effort — don't block inbound processing
    }
  }

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
      const msg = formatPostgrestError(error);
      if (/23505|duplicate key|unique constraint/i.test(msg)) {
        const existing = await this.findExistingEvent(tenantId, data.externalEventId);
        if (existing) return existing;
      }
      this.logger.error(`Failed to persist webhook event: ${msg}`);
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
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.debug(
      `Enqueued inbound message job: conversationId=${payload.ghlConversationId}`,
    );
  }

  /** Resolve internal conversation id from GHL conversation id for a given tenant. */
  async resolveConversationFromGhl(tenantId: string, ghlConversationId: string): Promise<{ data: { id: string } | null; error: unknown }> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_conversation_id', ghlConversationId)
      .maybeSingle();
    return { data: data as { id: string } | null, error };
  }

  /** Resolve tenant id from a GHL location id. */
  async resolveTenantFromLocation(ghlLocationId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('tenant_ghl_connections')
      .select('tenant_id')
      .eq('ghl_location_id', ghlLocationId)
      .eq('status', 'CONNECTED')
      .maybeSingle();
    return data && typeof (data as Record<string,unknown>)['tenant_id'] === 'string'
      ? (data as Record<string,unknown>)['tenant_id'] as string
      : null;
  }

  /** Find or return the conversation for a contact (by phone) under a tenant+location. Uses KB's conversation identity derivation. */
  async resolveConversationForContact(tenantId: string, ghlLocationId: string, phone: string): Promise<string> {
    // Use the same derivation as the inbound path: derive by key
    const identity = await this.deriveConversationKey(tenantId, { phone, channel: 'sms' });
    const { data: existing } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_conversation_id', identity.derivedConversationKey)
      .maybeSingle();
    if (existing) return (existing as { id: string }).id;

    // Create new conversation
    const newId = randomUUID();
    const now = new Date().toISOString();
    await this.supabase.from('conversations').insert({
      id: newId,
      tenant_id: tenantId,
      ghl_conversation_id: identity.derivedConversationKey,
      contact_id: identity.contactId ?? '',
      channel: 'SMS',
      status: 'ACTIVE',
      last_message_at: now,
      updated_at: now,
      metadata: { locationId: ghlLocationId },
    });
    return newId;
  }

  private async deriveConversationKey(
    tenantId: string,
    params: { phone?: string; channel?: string },
  ): Promise<{ derivedConversationKey: string; contactId: string }> {
    const contactId = params.phone?.trim() || params.channel || 'unknown';
    return {
      derivedConversationKey: `aisbp:conv:sms:${tenantId}:${contactId}`,
      contactId,
    };
  }

  /** Validate that a tenant owns the given GHL location. */
  async validateTenantOwnsLocation(tenantId: string, ghlLocationId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('tenant_ghl_connections')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_location_id', ghlLocationId)
      .eq('status', 'CONNECTED')
      .maybeSingle();
    return !!data;
  }

  /**
   * Record an outbound-through-KB message: persist the workflow-originated message
   * into the conversation so the AI has full context when replying.
   * Returns the newly created message id.
   */
  async recordOutboundThroughKb(params: {
    tenantId: string;
    ghlLocationId: string;
    conversationId: string;
    contactId: string;
    messageContent: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const msgId = randomUUID();
    const { error: insErr } = await this.supabase.from('messages').insert({
      id: msgId,
      tenant_id: params.tenantId,
      conversation_id: params.conversationId,
      direction: 'OUTBOUND',
      sender: 'SYSTEM',
      content: params.messageContent,
      contentType: 'TEXT',
      metadata: {
        sentAt: now,
        source: 'outbound_through_kb',
        ...(params.metadata ?? {}),
      },
    });
    if (insErr) {
      this.logger.error(`recordOutboundThroughKb insert failed: ${formatPostgrestError(insErr)}`);
      throw new BadRequestException(`Failed to record outbound message: ${formatPostgrestError(insErr)}`);
    }
    const { error: convErr } = await this.supabase
      .from('conversations')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', params.conversationId);
    if (convErr) {
      this.logger.warn(`recordOutboundThroughKb conversation touch failed: ${formatPostgrestError(convErr)}`);
    }
    this.logger.log(`outboundThroughKbRecorded: conversationId=${params.conversationId} messageId=${msgId}`);
    return { id: msgId };
  }

  /**
   * Handle native GHL OutboundMessage webhook events.
   * Records the outbound message into the conversation so the AI has full context.
   * Does NOT trigger AI — the message was already sent by GHL.
   */
  private async handleOutboundMessageWebhook(
    payload: GhlWebhookPayload,
    tenantId: string,
    externalEventId: string,
    dedupeKeyActual: string,
  ): Promise<void> {
    const data = payload.data ?? {};
    const contactId = (data as any)?.contactId as string | undefined ?? '';
    const messageText = (data as any)?.message as string | undefined
      ?? (data as any)?.body as string | undefined
      ?? '';
    const conversationId = (data as any)?.conversationId as string | undefined ?? '';

    if (!messageText || !contactId) {
      this.logger.warn(`outboundMessageWebhook skipped: no message or contact tenantId=${tenantId}`);
      return;
    }

    // Resolve internal conversation
    let internalConvId: string;
    if (conversationId) {
      const { data: conv } = await this.resolveConversationFromGhl(tenantId, conversationId);
      internalConvId = conv?.id ?? '';
    } else {
      internalConvId = await this.resolveConversationForContact(tenantId, payload.locationId, contactId);
    }

    if (!internalConvId) {
      this.logger.warn(`outboundMessageWebhook: no conversation found tenantId=${tenantId} contactId=${contactId}`);
      return;
    }

    // Record the outbound message (dedup via webhook_events)
    const msgId = randomUUID();
    const now = new Date().toISOString();
    const { error: insErr } = await this.supabase.from('messages').insert({
      id: msgId,
      tenant_id: tenantId,
      conversation_id: internalConvId,
      direction: 'OUTBOUND',
      sender: 'SYSTEM',
      content: messageText,
      contentType: 'TEXT',
      metadata: {
        sentAt: now,
        source: 'ghl_outbound_message_webhook',
        ghlMessageId: payload.data?.id ?? '',
        externalEventId,
        dedupeKey: dedupeKeyActual,
      },
    });
    if (insErr) {
      this.logger.warn(`outboundMessageWebhook insert failed: ${formatPostgrestError(insErr)}`);
      return;
    }
    this.logger.log(`outboundMessageRecorded: conversationId=${internalConvId} messageId=${msgId} contentPreview=${String(messageText).slice(0,80)}`);
  }

}
