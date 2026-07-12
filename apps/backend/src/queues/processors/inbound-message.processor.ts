// Inbound Message Processor
// - `persist`: store inbound message, bump debounce version, schedule delayed orchestration (default).
// - `orchestrate`: after quiet window, run routing + reply planning (single batch per version).
// - `smokeImmediate` on persist payload skips debounce (manual / header-driven smoke tests).

import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { QUEUES } from '../queue.constants';
import { ConversationOrchestrationService } from '../../modules/orchestration/orchestration.service';
import type { NormalizedWebhookPayload } from '../../modules/webhooks/dto/ghl-webhook.payload';
import { bumpInboundDebounceMeta, shouldSkipStaleDebounceJob } from '../../lib/inbound-debounce';
import {
  mergeConversationMetadataForPersist,
  readConversationMetadataField,
} from '../../lib/conversation-metadata-merge';
import { classifyConversationIntent } from '../../modules/conversation-policy/conversation-intent';
import { deriveConversationIdentity } from '../../lib/conversation-identity';
import { resolveGhlInboundChannel } from '../../lib/ghl-channel-routing';
import {
  filterInboundRowsToBurstWindow,
  inboundBurstLookbackMs,
  resolveInboundDebounceMs,
  type InboundRowForBurst,
} from '../../lib/inbound-burst-batch';
import { excludeChatResetInboundRows, matchChatResetCommand } from '../../lib/chat-reset-command';
import { parseAisbpPolicyState } from '../../modules/conversation-policy/conversation-policy-state';
import { computeOrchestrateQueueWaitMs } from '../../lib/orchestrate-queue-timing';
import { safeTextPreviewForLog } from '../../lib/safe-text-preview-for-log';
import { AppCacheService } from '../../lib/app-cache.service';
import { ConversationResetService } from '../../modules/conversations/conversation-reset.service';
import { InboundAutoTaggingService } from '../../modules/intent-tags/inbound-auto-tagging.service';
import {
  VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
} from '../../modules/transcription/audio-transcription.service';
import { GhlVoiceRecordingFetchService } from '../../modules/transcription/ghl-voice-recording-fetch.service';
import { GhlVoiceMessageDiscoveryService } from '../../modules/transcription/ghl-voice-message-discovery.service';
import { GhlVoiceConversationDiscoveryService } from '../../modules/transcription/ghl-voice-conversation-discovery.service';
import { classifyGhlAudioPlaceholderBody } from '../../modules/webhooks/ghl-inbound-audio-media';
import { INBOUND_IMAGE_PLACEHOLDER_CONTENT, isInboundImagePlaceholderContent } from '../../lib/inbound-image';
import {
  ghlBodyIndicatesImagePlaceholder,
  stripGhlImagePlaceholderFromInboundBody,
} from '../../modules/webhooks/ghl-inbound-image-media';
import { userAsksAboutRecentPhotoContent } from '../../lib/image-capability-intent';
import { resolveInboundGhlWebhookTenant } from '../../modules/webhooks/ghl-inbound-webhook-tenant-resolution';
import { FollowUpEngineService } from '../../modules/follow-up-engine/follow-up-engine.service';
import { HumanEscalationHoldingReplyService } from '../../modules/human-escalation/human-escalation-holding-reply.service';
import { MediaTranscriptionQueueService } from '../media-transcription-queue.service';
import { syncGhlConversationContext } from '../../lib/ghl-conversation-sync';
import { ingestInboundMessage } from '../../lib/inbound-message-ingest';
import { MetricsService } from '../../lib/metrics.service';
import { checkProviderOrchestrationGate, markProviderOrchestrationDone } from '../../lib/schedule-orchestration-if-new';
import { resolveContactIdIfPhone } from '../../lib/contact-resolve';
import { recordTerminalDecision, recordInterimDecision } from '../../lib/inbound-decision';
import type { InboundDecisionStatus } from '../../lib/inbound-decision';

function mapOutcomeToDecisionStatus(outcome: string): InboundDecisionStatus | null {
  switch (outcome) {
    case 'SKIP_AI_OFF_TAG': return 'SKIP_AI_OFF_TAG';
    case 'SKIP_HANDOVER_ACTIVE': return 'SKIP_HANDOVER_ACTIVE';
    case 'SKIP_DUPLICATE': return 'SKIP_DUPLICATE_PROVIDER_DONE';
    case 'SKIP_BOT_DISABLED':
    case 'SKIP_GHL_DISCONNECTED':
    case 'SKIP_AUTOMATION_PAUSED':
    case 'SKIP_QUOTA_EXHAUSTED':
    case 'SKIP_UNSUPPORTED_MESSAGE_TYPE':
    case 'SKIP_UNSUPPORTED_CHANNEL':
      return 'SKIP_HUMAN_TAKEOVER';
    default: return null;
  }
}

function buildBurstRowsOldestFirst(
  rowsNewestFirst: InboundRowForBurst[],
): Array<{ content: string; created_at: string }> {
  if (!rowsNewestFirst.length) return [];
  const newest = new Date(rowsNewestFirst[0]!.created_at).getTime();
  const cutoff = newest - inboundBurstLookbackMs();
  return [...rowsNewestFirst]
    .reverse()
    .filter(r => new Date(r.created_at).getTime() >= cutoff)
    .map(r => ({ content: String(r.content ?? '').trim(), created_at: r.created_at }))
    .filter(r => r.content.length > 0);
}

function normalizeBurstContent(content: string | null | undefined): string {
  return String(content ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseGhlWorkflowLocalTimestamp(raw: string): string | null {
  const trimmed = raw.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i.exec(trimmed);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  const ampm = m[7]?.toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  if (
    !Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year) ||
    !Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second) ||
    day < 1 || day > 31 || month < 1 || month > 12 || hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 || second < 0 || second > 59
  ) {
    return null;
  }

  const localValidationMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(localValidationMs);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return null;
  }
  // GHL workflow `{{right_now.time}}` values arrive without timezone. Apply an
  // explicitly configured legacy workflow offset; default to UTC with no regional assumption.
  const configuredOffset = Number(process.env['GHL_WORKFLOW_TIMEZONE_OFFSET_MINUTES'] ?? '0');
  const offsetMinutes = Number.isFinite(configuredOffset) ? configuredOffset : 0;
  const utcMs = Date.UTC(year, month - 1, day, hour, minute - offsetMinutes, second);
  return new Date(utcMs).toISOString();
}

export function normalizeInboundTimestampForPersist(raw: string | null | undefined): {
  iso: string;
  raw: string;
  source: 'input_iso' | 'workflow_local_dmy' | 'server_now';
} {
  const original = String(raw ?? '').trim();
  if (original) {
    const local = parseGhlWorkflowLocalTimestamp(original);
    if (local) return { iso: local, raw: original, source: 'workflow_local_dmy' };
    const ms = Date.parse(original);
    if (Number.isFinite(ms)) return { iso: new Date(ms).toISOString(), raw: original, source: 'input_iso' };
  }
  return { iso: new Date().toISOString(), raw: original, source: 'server_now' };
}

function collapseNearbyDuplicateInboundRows<T extends InboundRowForBurst>(
  rowsNewestFirst: T[],
  windowMs = 10_000,
): T[] {
  const outOldestFirst: T[] = [];
  for (const row of [...rowsNewestFirst].reverse()) {
    const prev = outOldestFirst[outOldestFirst.length - 1];
    if (prev) {
      const prevMs = Date.parse(prev.created_at);
      const rowMs = Date.parse(row.created_at);
      const sameContent = normalizeBurstContent(prev.content) === normalizeBurstContent(row.content);
      const closeTogether =
        Number.isFinite(prevMs) &&
        Number.isFinite(rowMs) &&
        Math.abs(rowMs - prevMs) <= windowMs;
      if (sameContent && closeTogether) {
        continue;
      }
    }
    outOldestFirst.push(row);
  }
  return outOldestFirst.reverse();
}

export interface InboundMessageJobData {
  locationId: string;
  ghlConversationId: string;
  ghlContactId: string;
  messageContent: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  timestamp: string;
  webhookEventId?: string;
  /** When true, persist then run orchestration immediately (no scheduled debounce). */
  smokeImmediate?: boolean;
  contactDisplayName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactFieldsFromExtendedWebhook?: boolean;
  /** Inbound audio media URL from GHL webhook (attachments / media). */
  audioMediaUrl?: string | null;
  /** Inbound image media URL from GHL webhook (attachments / media). */
  imageMediaUrl?: string | null;
  /** When true, run speech-to-text before persisting message content. */
  voiceInboundNeedsTranscribe?: boolean;
  /** GHL placeholder voice inbound with no media URL — persist metadata only, no transcription. */
  voiceInboundAudioPlaceholderWithoutMediaUrl?: boolean;
  /** Raw placeholder body before webhook replaced message text (Phase 1B). */
  voiceInboundPlaceholderRawBody?: string;
  /** Placeholder classifier result from webhook normalization (AUDIO, VOICE, UNSUPPORTED). */
  voiceInboundPlaceholderKind?: string;
  /** Outbound GHL message id from webhook data.id (recording fetch). */
  ghlInboundMessageId?: string;
  /** Webhook timestamp used to rank discovered message candidates. */
  webhookTimestampIso?: string;
  /** Set by WebhooksService when tenant was resolved at ingress (canonical routing). */
  resolvedTenantId?: string;
  /** GHL `data.channel` from webhook (facebook, instagram, whatsapp, sms, …). */
  channelRaw?: string;
  /** Raw GHL `data.messageType` (e.g. TYPE_FACEBOOK). */
  ghlMessageTypeRaw?: string;
  /** Original workflow-flat webhook body for Meta channel inference (contact/message/customData). */
  workflowFlatRaw?: Record<string, unknown>;
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
  /** Echo of inbound webhook `timestamp` field for ingress latency logs. */
  inboundWebhookReceivedAtIso?: string;
  /** Scheduled debounce delay for this orchestrate job (ms). */
  debounceConfiguredMs?: number;
  /** `Date.now()` when the inbound worker enqueued this debounced orchestrate job. */
  orchestrateEnqueuedAtMs?: number;
  /** GHL inbound channel at debounce schedule time (facebook, instagram, whatsapp, …). */
  channelRaw?: string;
  /** GHL inbound message ID for provider-level orchestration idempotency. */
  ghlInboundMessageId?: string;
}

@Processor(QUEUES.INBOUND_MESSAGE_PROCESSOR, { concurrency: 3 })
@Injectable()
export class InboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundMessageProcessor.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly orchestrationService: ConversationOrchestrationService,
    private readonly conversationResetService: ConversationResetService,
    private readonly inboundAutoTagging: InboundAutoTaggingService,
    private readonly mediaTranscriptionQueue: MediaTranscriptionQueueService,
    private readonly ghlVoiceRecordingFetch: GhlVoiceRecordingFetchService,
    private readonly ghlVoiceMessageDiscovery: GhlVoiceMessageDiscoveryService,
    private readonly ghlVoiceConversationDiscovery: GhlVoiceConversationDiscoveryService,
    private readonly followUpEngine: FollowUpEngineService,
    private readonly humanEscalationHolding: HumanEscalationHoldingReplyService,
    @InjectQueue(QUEUES.SEND_BUBBLE) private readonly sendBubbleQueue: Queue,
    @InjectQueue(QUEUES.INBOUND_MESSAGE_PROCESSOR) private readonly inboundQueue: Queue,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly appCache?: AppCacheService,
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
      timestamp: rawTimestamp,
      webhookEventId,
      smokeImmediate,
      contactDisplayName,
      contactPhone,
      contactEmail,
      contactFieldsFromExtendedWebhook,
      audioMediaUrl,
      imageMediaUrl,
      voiceInboundNeedsTranscribe,
      voiceInboundAudioPlaceholderWithoutMediaUrl,
      voiceInboundPlaceholderRawBody,
      voiceInboundPlaceholderKind,
      ghlInboundMessageId,
      resolvedTenantId,
      channelRaw,
      ghlMessageTypeRaw,
      workflowFlatRaw,
    } = job.data;
    const normalizedTimestamp = normalizeInboundTimestampForPersist(rawTimestamp);
    const timestamp = normalizedTimestamp.iso;

    const channelNorm = resolveGhlInboundChannel({
      channelRaw,
      messageTypeRaw: ghlMessageTypeRaw,
      contactPhone,
      workflowFlatRaw,
    });

    this.logger.log(
      `Inbound persist: conversationGhlId=${ghlConversationId}, type=${messageType}, channelRaw=${channelRaw ?? 'null'}, ghlMessageTypeRaw=${ghlMessageTypeRaw ?? 'null'}, resolvedOutbound=${channelNorm.outboundChannel}, channelSource=${channelNorm.source}, smokeImmediate=${Boolean(smokeImmediate)}, voiceInboundNeedsTranscribe=${Boolean(voiceInboundNeedsTranscribe)}`,
    );
    if (normalizedTimestamp.source !== 'input_iso') {
      this.logger.log(
        `Inbound timestamp normalized: source=${normalizedTimestamp.source} raw=${normalizedTimestamp.raw || '(empty)'} iso=${normalizedTimestamp.iso}`,
      );
    }

    if (webhookEventId) {
      await this.updateWebhookEventStatus(webhookEventId, 'PROCESSING');
    }

    try {
      let tenantId = resolvedTenantId;
      if (!tenantId) {
        const r = await resolveInboundGhlWebhookTenant({
          supabase: this.supabase,
          locationId,
          logger: this.logger,
        });
        if (!r.ok) {
          throw new Error(`Tenant not found for locationId: ${locationId} (${r.reason})`);
        }
        tenantId = r.tenantId;
      }
      const tenant = { id: tenantId };

      const conversation = await this.getOrCreateConversation(
        tenant.id,
        ghlConversationId,
        ghlContactId,
        timestamp,
        locationId,
        {
          channelRaw,
          ghlMessageTypeRaw,
          contactPhone,
          workflowFlatRaw,
        },
      );
      await this.refreshConversationChannel(conversation.id, channelNorm, locationId);

      const resolved = await this.resolveInboundContent(
        {
          messageContent,
          messageType,
          audioMediaUrl: audioMediaUrl ?? null,
          imageMediaUrl: imageMediaUrl ?? null,
          voiceInboundNeedsTranscribe: Boolean(voiceInboundNeedsTranscribe),
          voiceInboundAudioPlaceholderWithoutMediaUrl: Boolean(
            voiceInboundAudioPlaceholderWithoutMediaUrl,
          ),
          voiceInboundPlaceholderRawBody,
          voiceInboundPlaceholderKind,
          ghlInboundMessageId,
          ghlConversationId,
          ghlContactId,
          webhookTimestampIso: timestamp,
        },
        tenant.id,
        conversation.id,
        webhookEventId,
        locationId,
      );

      const useSharedIngest = process.env['GHL_WEBHOOK_SHARED_INGEST_ENABLED'] === 'true';
      const providerIdentityRequired =
        messageType === 'text' &&
        !(audioMediaUrl ?? '').trim() &&
        !(imageMediaUrl ?? '').trim() &&
        !voiceInboundNeedsTranscribe &&
        !voiceInboundAudioPlaceholderWithoutMediaUrl;
      const hasStableProviderIdentity =
        Boolean(ghlInboundMessageId?.trim()) || !providerIdentityRequired;

      // A workflow-shaped webhook without a provider message ID is evidence, not
      // trusted conversation content. Keep its webhook_events audit row, but let
      // focused GHL sync insert the provider-confirmed message. Otherwise a ghost
      // payload could leak into memory even when its direct orchestration is blocked.
      if (!hasStableProviderIdentity) {
        this.logger.warn(
          `Inbound message held for provider confirmation: conversationId=${conversation.id} webhookEventId=${webhookEventId ?? 'n/a'}`,
        );
      } else if (useSharedIngest) {
        const ingestResult = await ingestInboundMessage({
          supabase: this.supabase,
          conversationId: conversation.id,
          tenantId: tenant.id,
          direction: 'INBOUND',
          sender: 'CONTACT',
          content: resolved.content,
          contentType: this.mapToDbContentType(resolved.persistContentType),
          ghlMessageId: ghlInboundMessageId?.trim() || null,
          webhookEventId: webhookEventId || null,
          ghlTimestamp: timestamp,
          ingestSource: 'webhook',
          sourceMetadata: {
            receivedAt: timestamp,
            ...(normalizedTimestamp.raw && normalizedTimestamp.raw !== timestamp ? { receivedAtRaw: normalizedTimestamp.raw } : {}),
            timestampSource: normalizedTimestamp.source,
            ...resolved.voiceMetadata,
          },
        });

        if (ingestResult.duplicate || ingestResult.upgraded || ingestResult.skippedCrossPathDuplicate) {
          this.logger.log(
            `Inbound message deduped: conversationId=${conversation.id} duplicate=${ingestResult.duplicate} upgraded=${ingestResult.upgraded} skippedCrossPath=${ingestResult.skippedCrossPathDuplicate ?? false}`,
          );
          if (webhookEventId) await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
          // Do NOT return early — fall through to ensure orchestration is scheduled.
          // The provider gate below handles idempotency (done marker / lock) so
          // duplicate webhooks won't double-process. Without this fall-through,
          // shared-ingest dedup can persist a message but skip orchestration,
          // creating unrecoverable "unknown no-reply" gaps.
        }
      } else {
        await this.addMessage(tenantId, conversation.id, {
          direction: 'INBOUND',
          sender: 'CONTACT',
          content: resolved.content,
          contentType: resolved.persistContentType,
          metadata: {
            ghlMessageId: ghlInboundMessageId?.trim() || webhookEventId,
            ...(ghlInboundMessageId?.trim() ? { ghlInboundMessageId: ghlInboundMessageId.trim() } : {}),
            receivedAt: timestamp,
            ...(normalizedTimestamp.raw && normalizedTimestamp.raw !== timestamp ? { receivedAtRaw: normalizedTimestamp.raw } : {}),
            timestampSource: normalizedTimestamp.source,
            ...resolved.voiceMetadata,
          },
        });
      }

      const vm = resolved.voiceMetadata as Record<string, unknown>;
      const voiceDetected =
        Boolean(vm['inboundVoiceNote']) ||
        ['audio', 'voice'].includes(String(messageType ?? '').toLowerCase()) ||
        Boolean(voiceInboundAudioPlaceholderWithoutMediaUrl) ||
        Boolean(voiceInboundNeedsTranscribe);
      const transcriptionAttempted = Object.keys(vm).length > 0;
      const transcriptionSucceeded = vm['voiceTranscriptionStatus'] === 'succeeded';
      const transcriptCharLength =
        transcriptionSucceeded && typeof resolved.content === 'string' ? resolved.content.length : null;
      const transcriptionFailureReason =
        transcriptionSucceeded === true
          ? null
          : ((vm['voiceRetrievalFailureReason'] ?? vm['voiceTranscriptionStatus']) as string | null) ?? null;
      if (voiceDetected || transcriptionAttempted) {
        this.logger.log(
          JSON.stringify({
            inboundVoiceTelemetry: {
              messageType,
              voiceDetected,
              transcriptionAttempted,
              transcriptionSucceeded,
              transcriptCharLength,
              transcriptionFailureReason,
            },
          }),
        );
      }

      this.logger.log(
        hasStableProviderIdentity
          ? `Inbound message stored: conversationId=${conversation.id}, messageType=${resolved.persistContentType}`
          : `Inbound message awaiting provider confirmation: conversationId=${conversation.id}, messageType=${resolved.persistContentType}`,
      );

      // Only provider-confirmed content may stop follow-ups or opt a customer out.
      if (hasStableProviderIdentity) {
        try {
          await this.followUpEngine.noteInboundFromContact({
            tenantId: tenant.id,
            conversationId: conversation.id,
            inboundText: resolved.content,
            inboundAtIso: timestamp,
          });
        } catch (e) {
          this.logger.warn(
            `followUpInboundHookFailed ${JSON.stringify({
              tenantId: tenant.id,
              conversationId: conversation.id,
              msg: e instanceof Error ? e.message : String(e),
            })}`,
          );
        }
      }
      const webhookParsedAt = Date.parse(timestamp);
      const webhook_to_persist_ms = Number.isFinite(webhookParsedAt) ? Date.now() - webhookParsedAt : null;
      this.logger.log(
        `inboundPersistTiming: conversationId=${conversation.id} webhook_to_persist_ms=${webhook_to_persist_ms ?? 'na'}`,
      );

      if (smokeImmediate && hasStableProviderIdentity) {
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
          pipelineWallStartMs: Date.now(),
          orchestrateQueueWaitMs: null,
          debounceConfiguredMs: 0,
          channelRaw,
        });
        if (webhookEventId) await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
        return;
      }

      const { data: convMetaRow } = await this.supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversation.id)
        .single();
      const currentMeta = readConversationMetadataField(convMetaRow?.metadata);
      const { merged: debounceBump, newVersion } = bumpInboundDebounceMeta(currentMeta);
      const merged = mergeConversationMetadataForPersist(currentMeta, debounceBump);
      const { error: metaErr } = await this.supabase
        .from('conversations')
        .update({ metadata: merged, updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
      if (metaErr) {
        this.logger.warn(`Failed to bump inbound debounce metadata: ${formatPostgrestError(metaErr)}`);
      }

      const { debounceMs, debounceSource } = resolveInboundDebounceMs();
      const orchestrateEnqueuedAtMs = Date.now();

      // Provider-level idempotency gate: prevent duplicate orchestration when
      // sync fallback and webhook both see the same GHL message.
      const providerGate = await checkProviderOrchestrationGate({
        appCache: this.appCache,
        logger: this.logger,
        tenantId: tenant.id,
        conversationId: conversation.id,
        ghlMessageId: ghlInboundMessageId?.trim() || null,
        ghlTimestamp: timestamp,
        source: 'webhook',
        allowMissingProviderIdForVerifiedMedia: !providerIdentityRequired,
      });
      if (!providerGate.allowed) {
        this.logger.log(
          `Orchestration skipped (provider gate): conversationId=${conversation.id} reason=${providerGate.reason}`,
        );

        // No ghlMessageId → trigger focused GHL sync to recover the real ID
        if (providerGate.reason === 'no_ghl_message_id') {
          await this.recoverOrchestrationViaSync(
            tenant.id,
            conversation.id,
            locationId,
            ghlContactId,
          );
        }

        if (webhookEventId) await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
        return;
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
          inboundWebhookReceivedAtIso: timestamp,
          debounceConfiguredMs: debounceMs,
          orchestrateEnqueuedAtMs,
          channelRaw,
          ghlInboundMessageId: ghlInboundMessageId?.trim() || undefined,
        } satisfies OrchestrateDebouncedJobData,
        {
          delay: debounceMs,
          jobId: `deb:${conversation.id}:${newVersion}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 1500 },
          removeOnComplete: true,
        },
      );

      this.logger.log(
        `Debounce scheduled: conversationId=${conversation.id}, processAfterMs=${debounceMs}, debounceMs=${debounceMs}, debounceSource=${debounceSource}, version=${newVersion}`,
      );

      if (webhookEventId) {
        await this.updateWebhookEventStatus(webhookEventId, 'ORCHESTRATING');
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
  private async tryTranscribeFromGhlRecording(params: {
    tenantId: string;
    locationId: string;
    messageId: string;
    conversationId: string;
    webhookEventId: string | undefined;
    transcriptionSourceLabel: string;
  }): Promise<
    | {
        ok: true;
        transcript: string;
        mediaBytes: number;
        contentType: string | null;
      }
    | { ok: false; failureReason: string }
  > {
    const fetched = await this.ghlVoiceRecordingFetch.tryFetchRecording({
      tenantId: params.tenantId,
      locationId: params.locationId,
      messageId: params.messageId,
    });
    if (!fetched.ok) {
      const fr =
        fetched.reason === 'http_422' ? 'recording_fetch_http_422' : fetched.reason;
      return { ok: false, failureReason: fr };
    }
    const tx = await this.mediaTranscriptionQueue.transcribeAudioBuffer({
      tenantId: params.tenantId,
      buffer: fetched.buffer,
      contentType: fetched.contentType,
      conversationId: params.conversationId,
      webhookEventId: params.webhookEventId,
      sourceLabel: params.transcriptionSourceLabel,
    });
    if (!tx.ok) {
      return { ok: false, failureReason: 'transcription_failed' };
    }
    return {
      ok: true,
      transcript: tx.transcript,
      mediaBytes: tx.mediaBytes,
      contentType: tx.contentType,
    };
  }

  private async resolveGhlConversationIdForImageDiscovery(params: {
    tenantId: string;
    locationId: string;
    ghlConversationId?: string;
    ghlContactId?: string;
  }): Promise<string | null> {
    const direct = params.ghlConversationId?.trim();
    if (direct) return direct;
    const contactId = params.ghlContactId?.trim();
    if (!contactId || !params.locationId.trim()) return null;
    const discovered = await this.ghlVoiceConversationDiscovery.discoverConversationIdByContact({
      tenantId: params.tenantId,
      locationId: params.locationId,
      contactId,
    });
    if (discovered.ok) {
      this.logger.log(
        JSON.stringify({
          inboundImageConversationDiscoverySucceeded: true,
          candidateCount: discovered.candidateCount,
        }),
      );
      return discovered.conversationId;
    }
    this.logger.warn(
      JSON.stringify({
        inboundImageConversationDiscoveryFailed: true,
        reason: discovered.reason,
        candidateCount: discovered.candidateCount ?? 0,
      }),
    );
    return null;
  }

  private async resolveImageInboundContent(
    job: Pick<
      InboundMessageJobData,
      'messageContent' | 'imageMediaUrl' | 'ghlConversationId' | 'ghlInboundMessageId' | 'ghlContactId'
    > & { webhookTimestampIso: string },
    tenantId: string,
    locationId: string,
  ): Promise<{
    content: string;
    persistContentType: 'image';
    voiceMetadata: Record<string, unknown>;
  }> {
    let url = (job.imageMediaUrl ?? '').trim();
    const discoverEnabled = process.env['GHL_IMAGE_DISCOVER_MEDIA_URL'] !== 'false';
    const canDiscover =
      Boolean(job.ghlInboundMessageId?.trim()) ||
      Boolean(job.ghlConversationId?.trim()) ||
      Boolean(job.ghlContactId?.trim());
    if (!url && discoverEnabled && locationId.trim() && canDiscover) {
      const conversationId = await this.resolveGhlConversationIdForImageDiscovery({
        tenantId,
        locationId,
        ghlConversationId: job.ghlConversationId,
        ghlContactId: job.ghlContactId,
      });
      const discovered = await this.ghlVoiceMessageDiscovery.discoverInboundImageMediaUrl({
        tenantId,
        locationId,
        ...(conversationId ? { conversationId } : {}),
        webhookTimestampIso: job.webhookTimestampIso,
        preferredMessageId: job.ghlInboundMessageId?.trim() || undefined,
      });
      if (discovered.ok) {
        url = discovered.imageMediaUrl;
        this.logger.log(
          JSON.stringify({
            inboundImageDiscoverySucceeded: true,
            candidateCount: discovered.candidateCount,
            messageIdPresent: Boolean(discovered.messageId),
          }),
        );
      } else {
        this.logger.warn(
          JSON.stringify({
            inboundImageDiscoveryFailed: true,
            reason: discovered.reason,
            candidateCount: discovered.candidateCount ?? 0,
          }),
        );
      }
    }
    const caption = stripGhlImagePlaceholderFromInboundBody(String(job.messageContent ?? ''));
    return {
      content: caption || INBOUND_IMAGE_PLACEHOLDER_CONTENT,
      persistContentType: 'image',
      voiceMetadata: {
        inboundImage: true,
        ...(job.ghlInboundMessageId?.trim()
          ? { ghlInboundMessageId: job.ghlInboundMessageId.trim() }
          : {}),
        ...(url ? { imageMediaUrl: url } : { imageMediaUrlMissing: true }),
      },
    };
  }

  private async resolveInboundContent(
    job: Pick<
      InboundMessageJobData,
      | 'messageContent'
      | 'messageType'
      | 'audioMediaUrl'
      | 'imageMediaUrl'
      | 'voiceInboundNeedsTranscribe'
      | 'voiceInboundAudioPlaceholderWithoutMediaUrl'
      | 'voiceInboundPlaceholderRawBody'
      | 'voiceInboundPlaceholderKind'
      | 'ghlInboundMessageId'
      | 'ghlConversationId'
      | 'ghlContactId'
    > & { webhookTimestampIso: string },
    tenantId: string,
    conversationId: string,
    webhookEventId: string | undefined,
    locationId: string,
  ): Promise<{
    content: string;
    persistContentType: InboundMessageJobData['messageType'];
    voiceMetadata: Record<string, unknown>;
  }> {
    if (job.messageType === 'image' || (job.imageMediaUrl ?? '').trim() || ghlBodyIndicatesImagePlaceholder(job.messageContent)) {
      return this.resolveImageInboundContent(job, tenantId, locationId);
    }
    return this.resolveVoiceInboundContent(
      job,
      tenantId,
      conversationId,
      webhookEventId,
      locationId,
    );
  }

  private async resolveVoiceInboundContent(
    job: Pick<
      InboundMessageJobData,
      | 'messageContent'
      | 'messageType'
      | 'audioMediaUrl'
      | 'voiceInboundNeedsTranscribe'
      | 'voiceInboundAudioPlaceholderWithoutMediaUrl'
      | 'voiceInboundPlaceholderRawBody'
      | 'voiceInboundPlaceholderKind'
      | 'ghlInboundMessageId'
      | 'ghlConversationId'
      | 'ghlContactId'
    > & { webhookTimestampIso: string },
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
    const discoverMessageIdEnabled =
      process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] === 'true';
    const discoverConversationIdEnabled =
      process.env['GHL_VOICE_DISCOVER_CONVERSATION_ID'] === 'true';
    const rawPh = job.voiceInboundPlaceholderRawBody?.trim();
    const msgId = job.ghlInboundMessageId?.trim();
    const noMediaUrl = !(job.audioMediaUrl ?? '').trim();
    const phKind = job.voiceInboundPlaceholderKind;
    const convGhl = job.ghlConversationId?.trim() ?? '';
    const contactId = job.ghlContactId?.trim() ?? '';
    const locationPresent = Boolean(locationId.trim());
    const isAudioOrVoicePlaceholder = phKind === 'AUDIO' || phKind === 'VOICE';

    if (
      fetchRecordingEnabled &&
      noMediaUrl &&
      msgId &&
      rawPh &&
      classifyGhlAudioPlaceholderBody(rawPh) !== 'UNKNOWN'
    ) {
      const tr = await this.tryTranscribeFromGhlRecording({
        tenantId,
        locationId,
        messageId: msgId,
        conversationId,
        webhookEventId,
        transcriptionSourceLabel: 'ghl_recording_api',
      });
      if (tr.ok) {
        return {
          content: tr.transcript,
          persistContentType: 'text',
          voiceMetadata: {
            inboundVoiceNote: true,
            voiceTranscriptionStatus: 'succeeded',
            voiceRecordingFetchedFromGhl: true,
            voiceRetrievalMethod: 'ghl_recording_fetch_direct',
            voiceMediaBytes: tr.mediaBytes,
            voiceMediaContentType: tr.contentType,
          },
        };
      }
      return {
        content: VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
        persistContentType: 'text',
        voiceMetadata: {
          inboundVoiceNote: true,
          voiceTranscriptionStatus: 'failed',
          voiceRetrievalMethod: 'ghl_recording_fetch_direct',
          voiceRetrievalFailureReason: tr.failureReason,
        },
      };
    }

    if (
      discoverMessageIdEnabled &&
      job.voiceInboundAudioPlaceholderWithoutMediaUrl &&
      noMediaUrl &&
      !msgId &&
      convGhl &&
      locationId.trim() &&
      (phKind === 'AUDIO' || phKind === 'VOICE')
    ) {
      const discovered = await this.ghlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId({
        tenantId,
        locationId,
        conversationId: convGhl,
        webhookTimestampIso: job.webhookTimestampIso,
        placeholderKind: phKind,
      });

      if (discovered.ok) {
        if (discovered.audioMediaUrl) {
          const tx = await this.mediaTranscriptionQueue.transcribeRemoteMedia({
            tenantId,
            mediaUrl: discovered.audioMediaUrl,
            conversationId,
            webhookEventId,
          });
          if (tx.ok) {
            let mediaHost: string | null = null;
            try {
              mediaHost = new URL(discovered.audioMediaUrl).hostname;
            } catch {
              mediaHost = null;
            }
            return {
              content: tx.transcript,
              persistContentType: 'text',
              voiceMetadata: {
                inboundVoiceNote: true,
                voiceTranscriptionStatus: 'succeeded',
                voiceRetrievalMethod: 'ghl_message_history_direct_media_url',
                voiceDiscoveredMessageId: Boolean(discovered.messageId),
                voiceDiscoveredConversationId: true,
                voiceOriginalMediaHost: mediaHost,
                voiceMediaBytes: tx.mediaBytes,
                voiceMediaContentType: tx.contentType,
              },
            };
          }
          this.logger.warn(
            JSON.stringify({
              voiceDiscoveryTranscriptionFailedAfterDirectMediaUrl: true,
              directAudioMediaUrlPresent: true,
              attachmentUrlFound: Boolean(discovered.attachmentUrlFound),
              audioMediaUrlShape: discovered.audioMediaUrlShape ?? null,
              candidateReason: discovered.candidateReason,
              candidateCount: discovered.candidateCount,
              detectedCollectionPath: discovered.detectedCollectionPath,
              latestMessageSamples: discovered.debugLatestMessageSamples ?? [],
            }),
          );
          return {
            content: VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
            persistContentType: 'text',
            voiceMetadata: {
              inboundVoiceNote: true,
              voiceInboundAudioPlaceholderWithoutMediaUrl: true,
              voiceTranscriptionStatus: 'failed',
              voiceRetrievalMethod: 'ghl_message_history_direct_media_url',
              voiceDiscoveredMessageId: Boolean(discovered.messageId),
              voiceDiscoveredConversationId: true,
              voiceRetrievalFailureReason: 'transcription_failed',
            },
          };
        }
        if (!discovered.messageId) {
          return {
            content: job.messageContent,
            persistContentType: 'text',
            voiceMetadata: {
              inboundVoiceNote: true,
              voiceInboundAudioPlaceholderWithoutMediaUrl: true,
              voiceTranscriptionStatus: 'media_url_missing',
              voiceRetrievalMethod: 'ghl_message_discovery_recording_fetch',
              voiceDiscoveredMessageId: false,
              voiceDiscoveredConversationId: true,
              voiceRetrievalFailureReason: 'audio_media_url_not_found',
            },
          };
        }
        const tr = await this.tryTranscribeFromGhlRecording({
          tenantId,
          locationId,
          messageId: discovered.messageId,
          conversationId,
          webhookEventId,
          transcriptionSourceLabel: 'ghl_recording_discovery',
        });
        if (tr.ok) {
          return {
            content: tr.transcript,
            persistContentType: 'text',
            voiceMetadata: {
              inboundVoiceNote: true,
              voiceTranscriptionStatus: 'succeeded',
              voiceRetrievalMethod: 'ghl_message_discovery_recording_fetch',
              voiceDiscoveredMessageId: true,
              voiceDiscoveredConversationId: true,
              voiceMediaBytes: tr.mediaBytes,
              voiceMediaContentType: tr.contentType,
            },
          };
        }
        return {
          content: VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
          persistContentType: 'text',
          voiceMetadata: {
            inboundVoiceNote: true,
            voiceInboundAudioPlaceholderWithoutMediaUrl: true,
            voiceTranscriptionStatus: 'failed',
            voiceRetrievalMethod: 'ghl_message_discovery_recording_fetch',
            voiceDiscoveredMessageId: true,
            voiceDiscoveredConversationId: true,
            voiceRetrievalFailureReason: tr.failureReason,
          },
        };
      }

      return {
        content: job.messageContent,
        persistContentType: 'text',
        voiceMetadata: {
          inboundVoiceNote: true,
          voiceInboundAudioPlaceholderWithoutMediaUrl: true,
          voiceTranscriptionStatus: 'media_url_missing',
          voiceRetrievalMethod: 'ghl_message_discovery_recording_fetch',
          voiceDiscoveredMessageId: false,
          voiceDiscoveredConversationId: true,
          voiceRetrievalFailureReason: discovered.reason,
        },
      };
    }

    const shouldAttemptConversationDiscovery =
      discoverConversationIdEnabled &&
      job.voiceInboundAudioPlaceholderWithoutMediaUrl &&
      noMediaUrl &&
      !msgId &&
      !convGhl &&
      contactId &&
      locationPresent &&
      isAudioOrVoicePlaceholder;

    if (shouldAttemptConversationDiscovery) {
      const convDiscovered =
        await this.ghlVoiceConversationDiscovery.discoverConversationIdByContact({
          tenantId,
          locationId,
          contactId,
        });
      if (!convDiscovered.ok) {
        return {
          content: job.messageContent,
          persistContentType: 'text',
          voiceMetadata: {
            inboundVoiceNote: true,
            voiceInboundAudioPlaceholderWithoutMediaUrl: true,
            voiceTranscriptionStatus: 'media_url_missing',
            voiceRetrievalMethod:
              'ghl_conversation_discovery_message_discovery_recording_fetch',
            voiceDiscoveredConversationId: false,
            voiceDiscoveredMessageId: false,
            voiceRetrievalFailureReason: convDiscovered.reason,
          },
        };
      }

      const discoveredMsg = await this.ghlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId({
        tenantId,
        locationId,
        conversationId: convDiscovered.conversationId,
        webhookTimestampIso: job.webhookTimestampIso,
        placeholderKind: phKind,
      });
      if (!discoveredMsg.ok) {
        return {
          content: job.messageContent,
          persistContentType: 'text',
          voiceMetadata: {
            inboundVoiceNote: true,
            voiceInboundAudioPlaceholderWithoutMediaUrl: true,
            voiceTranscriptionStatus: 'media_url_missing',
            voiceRetrievalMethod:
              'ghl_conversation_discovery_message_discovery_recording_fetch',
            voiceDiscoveredConversationId: true,
            voiceDiscoveredMessageId: false,
            voiceRetrievalFailureReason: discoveredMsg.reason,
          },
        };
      }

      if (discoveredMsg.audioMediaUrl) {
        const tx = await this.mediaTranscriptionQueue.transcribeRemoteMedia({
          tenantId,
          mediaUrl: discoveredMsg.audioMediaUrl,
          conversationId,
          webhookEventId,
        });
        if (tx.ok) {
          let mediaHost: string | null = null;
          try {
            mediaHost = new URL(discoveredMsg.audioMediaUrl).hostname;
          } catch {
            mediaHost = null;
          }
          return {
            content: tx.transcript,
            persistContentType: 'text',
            voiceMetadata: {
              inboundVoiceNote: true,
              voiceTranscriptionStatus: 'succeeded',
              voiceRetrievalMethod: 'ghl_message_history_direct_media_url',
              voiceDiscoveredConversationId: true,
              voiceDiscoveredMessageId: Boolean(discoveredMsg.messageId),
              voiceOriginalMediaHost: mediaHost,
              voiceMediaBytes: tx.mediaBytes,
              voiceMediaContentType: tx.contentType,
            },
          };
        }
        this.logger.warn(
          JSON.stringify({
            voiceDiscoveryTranscriptionFailedAfterDirectMediaUrl: true,
            directAudioMediaUrlPresent: true,
            attachmentUrlFound: Boolean(discoveredMsg.attachmentUrlFound),
            audioMediaUrlShape: discoveredMsg.audioMediaUrlShape ?? null,
            candidateReason: discoveredMsg.candidateReason,
            candidateCount: discoveredMsg.candidateCount,
            detectedCollectionPath: discoveredMsg.detectedCollectionPath,
            latestMessageSamples: discoveredMsg.debugLatestMessageSamples ?? [],
          }),
        );
        return {
          content: VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
          persistContentType: 'text',
          voiceMetadata: {
            inboundVoiceNote: true,
            voiceInboundAudioPlaceholderWithoutMediaUrl: true,
            voiceTranscriptionStatus: 'failed',
            voiceRetrievalMethod: 'ghl_message_history_direct_media_url',
            voiceDiscoveredConversationId: true,
            voiceDiscoveredMessageId: Boolean(discoveredMsg.messageId),
            voiceRetrievalFailureReason: 'transcription_failed',
          },
        };
      }
      if (!discoveredMsg.messageId) {
        return {
          content: job.messageContent,
          persistContentType: 'text',
          voiceMetadata: {
            inboundVoiceNote: true,
            voiceInboundAudioPlaceholderWithoutMediaUrl: true,
            voiceTranscriptionStatus: 'media_url_missing',
            voiceRetrievalMethod:
              'ghl_conversation_discovery_message_discovery_recording_fetch',
            voiceDiscoveredConversationId: true,
            voiceDiscoveredMessageId: false,
            voiceRetrievalFailureReason: 'audio_media_url_not_found',
          },
        };
      }

      const tr = await this.tryTranscribeFromGhlRecording({
        tenantId,
        locationId,
        messageId: discoveredMsg.messageId,
        conversationId,
        webhookEventId,
        transcriptionSourceLabel: 'ghl_conv_msg_recording_discovery',
      });
      if (tr.ok) {
        return {
          content: tr.transcript,
          persistContentType: 'text',
          voiceMetadata: {
            inboundVoiceNote: true,
            voiceTranscriptionStatus: 'succeeded',
            voiceRetrievalMethod:
              'ghl_conversation_discovery_message_discovery_recording_fetch',
            voiceDiscoveredConversationId: true,
            voiceDiscoveredMessageId: true,
            voiceMediaBytes: tr.mediaBytes,
            voiceMediaContentType: tr.contentType,
          },
        };
      }

      return {
        content: VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
        persistContentType: 'text',
        voiceMetadata: {
          inboundVoiceNote: true,
          voiceInboundAudioPlaceholderWithoutMediaUrl: true,
          voiceTranscriptionStatus: 'failed',
          voiceRetrievalMethod:
            'ghl_conversation_discovery_message_discovery_recording_fetch',
          voiceDiscoveredConversationId: true,
          voiceDiscoveredMessageId: true,
          voiceRetrievalFailureReason: tr.failureReason,
        },
      };
    }

    const skipConversationDiscoveryReason = !discoverConversationIdEnabled
      ? 'env_disabled'
      : !job.voiceInboundAudioPlaceholderWithoutMediaUrl
        ? 'placeholder_flag_missing'
        : !isAudioOrVoicePlaceholder
          ? 'placeholder_not_audio_or_voice'
          : !noMediaUrl
            ? 'media_url_present'
            : Boolean(msgId)
              ? 'webhook_message_id_present'
              : Boolean(convGhl)
                ? 'conversation_id_present'
                : !contactId
                  ? 'contact_id_missing'
                  : !locationPresent
                    ? 'location_id_missing'
                    : null;
    if (skipConversationDiscoveryReason) {
      this.logger.log(
        JSON.stringify({
          voiceConversationDiscoverySkipped: true,
          reason: skipConversationDiscoveryReason,
        }),
      );
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

    const tx = await this.mediaTranscriptionQueue.transcribeRemoteMedia({
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
      debounceConfiguredMs,
      orchestrateEnqueuedAtMs,
    } = job.data;

    const { data: convRow, error: cErr } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .single();
    if (cErr || !convRow) {
      this.logger.warn(`Debounce orchestrate: conversation not found ${conversationId}`);
      if (webhookEventId) {
        await this.updateWebhookEventStatus(webhookEventId, 'FAILED', 'conversation_not_found');
      }
      return;
    }

    if (shouldSkipStaleDebounceJob(convRow.metadata, debounceVersion)) {
      this.logger.log(
        `Debounce skipped: newer inbound exists conversationId=${conversationId} (jobVersion=${debounceVersion})`,
      );
      if (webhookEventId) {
        await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
      }
      return;
    }

    const pipelineWallStartMs = Date.now();
    const orchestrateQueueWaitMs = computeOrchestrateQueueWaitMs(
      pipelineWallStartMs,
      orchestrateEnqueuedAtMs,
    );
    const latestInbound = await this.fetchLatestInboundOrchestrationContext(conversationId);
    const policyForBatch = parseAisbpPolicyState(
      convRow.metadata && typeof convRow.metadata === 'object' && !Array.isArray(convRow.metadata)
        ? (convRow.metadata as Record<string, unknown>)
        : undefined,
    );
    const { orchestrationBatch, resetDetectionBatch, resetDetectionRows } =
      await this.fetchRecentInboundBatches(conversationId, {
        memoryResetAfterIso: policyForBatch.memoryResetAt ?? null,
        alwaysIncludeMessageId: latestInbound.id ?? null,
      });
    const latestText = orchestrationBatch.length ? orchestrationBatch[orchestrationBatch.length - 1]! : '';

    this.logger.log(
      `inboundOrchIngress: conversationId=${conversationId} orchestrate_queue_wait_ms=${orchestrateQueueWaitMs ?? 'na'} debounce_ms=${debounceConfiguredMs ?? 'na'}`,
    );

    const latestIntent = latestText ? classifyConversationIntent(latestText) : 'UNKNOWN';
    const combinedText = orchestrationBatch.join('\n\n').trim();
    const allowHead = Boolean(matchChatResetCommand(latestText.trim()));
    const clip = (lines: string[]) =>
      lines.map((t) =>
        safeTextPreviewForLog(t, {
          allowHeadInProduction: allowHead,
          headChars: 12,
          hashSalt: 'inbound_batch_line',
        }),
      );
    this.logger.log(
      `Debounce inbound batches: conversationId=${conversationId} ` +
        `orchestrationInboundCount=${orchestrationBatch.length} ` +
        `resetDetectionInboundCount=${resetDetectionBatch.length} ` +
        `resetDetectionBatchPreview=${JSON.stringify(clip(resetDetectionBatch))} ` +
        `orchestrationBatchPreview=${JSON.stringify(clip(orchestrationBatch))} ` +
        `uniqueOrchestrationLines=${new Set(orchestrationBatch).size} latestIntent=${latestIntent} ` +
        `orchestrationCombinedTextPreviewLen=${combinedText.length}`,
    );

    await this.executeOrchestrationPipeline({
      tenantId,
      conversationId,
      locationId,
      ghlContactId,
      ghlConversationId,
      webhookEventId,
      latestInboundText: latestText,
      latestInboundMessageType: latestInbound.messageType,
      latestInboundImageUrl: latestInbound.imageMediaUrl,
      latestInboundPreferredMessageId: latestInbound.preferredMessageId,
      inboundWebhookTimestampIso: job.data.inboundWebhookReceivedAtIso ?? new Date().toISOString(),
      recentInboundBatch: orchestrationBatch,
      resetDetectionBatch,
      resetDetectionRows,
      contactDisplayName,
      contactPhone,
      contactEmail,
      contactFieldsFromExtendedWebhook,
      pipelineWallStartMs,
      orchestrateQueueWaitMs,
      debounceConfiguredMs: debounceConfiguredMs ?? null,
      channelRaw: job.data.channelRaw,
      ghlInboundMessageId: job.data.ghlInboundMessageId,
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
    latestInboundMessageType?: InboundMessageJobData['messageType'];
    latestInboundImageUrl?: string | null;
    latestInboundPreferredMessageId?: string | null;
    inboundWebhookTimestampIso?: string;
    recentInboundBatch?: string[];
    /** Raw burst-window lines (oldest→newest), including `/new`, so trailing reset commands still run */
    resetDetectionBatch?: string[];
    /** Raw burst-window rows (oldest→newest), including `/new`, for reset timestamp anchoring. */
    resetDetectionRows?: Array<{ content: string; created_at: string }>;
    contactDisplayName?: string;
    contactPhone?: string;
    contactEmail?: string;
    contactFieldsFromExtendedWebhook?: boolean;
    pipelineWallStartMs?: number;
    orchestrateQueueWaitMs?: number | null;
    debounceConfiguredMs?: number | null;
    channelRaw?: string;
    ghlInboundMessageId?: string;
  }): Promise<void> {
    const {
      tenantId,
      conversationId,
      locationId,
      ghlContactId,
      ghlConversationId,
      webhookEventId,
      latestInboundText,
      latestInboundMessageType,
      latestInboundImageUrl,
      latestInboundPreferredMessageId,
      inboundWebhookTimestampIso,
      recentInboundBatch,
      resetDetectionBatch,
      resetDetectionRows,
      contactDisplayName,
      contactPhone,
      contactEmail,
      contactFieldsFromExtendedWebhook,
      pipelineWallStartMs,
      orchestrateQueueWaitMs,
      debounceConfiguredMs,
      channelRaw,
      ghlInboundMessageId: ctxGhlMsgId,
    } = ctx;

    if (
      await this.tryHandleChatResetCommand({
        tenantId,
        conversationId,
        locationId,
        ghlContactId,
        latestInboundText,
        recentInboundBatch,
        resetDetectionBatch,
        resetDetectionRows,
      })
    ) {
      this.logger.log(
        `Orchestration skipped (chat reset command): conversationId=${conversationId} ` +
          `orchestrationSkippedReason=chat_reset_command`,
      );
      if (webhookEventId) {
        await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
      }
      return;
    }

    const messageTextForTags =
      recentInboundBatch && recentInboundBatch.length > 0
        ? recentInboundBatch.join('\n\n').trim()
        : String(latestInboundText ?? '').trim();

    const taggingStarted = Date.now();
    void this.inboundAutoTagging
      .evaluateAndApplyAutoTags({
        tenantId,
        conversationId,
        contactId: ghlContactId,
        ghlLocationId: locationId,
        messageText: messageTextForTags,
      })
      .then(() => {
        this.logger.log(
          `inboundAutoTaggingTiming: conversationId=${conversationId} auto_tagging_ms=${Date.now() - taggingStarted}`,
        );
      })
      .catch((e: unknown) => {
        this.logger.error(
          `Inbound auto-tagging failed: conversationId=${conversationId} msg=${e instanceof Error ? e.message : String(e)}`,
        );
      });

    const normalizedPayload: NormalizedWebhookPayload = {
      ghlLocationId: locationId,
      ghlConversationId,
      ghlContactId,
      messageContent: latestInboundText,
      messageType: latestInboundMessageType ?? 'text',
      imageMediaUrl: await this.resolveOrchestrationImageUrl({
        tenantId,
        conversationId,
        locationId,
        ghlConversationId,
        ghlContactId,
        latestInboundMessageType: latestInboundMessageType ?? 'text',
        latestInboundText,
        latestInboundImageUrl: latestInboundImageUrl ?? null,
        preferredMessageId: latestInboundPreferredMessageId ?? null,
        inboundWebhookTimestampIso: inboundWebhookTimestampIso ?? new Date().toISOString(),
      }),
      timestamp: new Date().toISOString(),
      externalEventId: webhookEventId ?? `local:${conversationId}:${Date.now()}`,
      eventType: 'inbound_message',
      dedupeKey: `orch:${conversationId}:${Date.now()}`,
      channelRaw: channelRaw ?? null,
      contactDisplayName: contactDisplayName?.trim() || null,
      contactPhone: contactPhone?.trim() || null,
      contactEmail: contactEmail?.trim() || null,
      contactFieldsFromExtendedWebhook: contactFieldsFromExtendedWebhook ?? null,
    };

    const tenantContext = await this.orchestrationService.loadTenantContext(tenantId);
    const promptConfig = await this.orchestrationService.loadPromptConfig(tenantId);
    const agencyPolicy = await this.orchestrationService.loadAgencyPolicy(tenantId);
    const conversationRecord = await this.orchestrationService.loadConversation(conversationId);

    // Pre-reply GHL context sync: hydrate KB with recent GHL workflow/inbox
    // messages before prompt memory loads. Best-effort only — sync must never
    // be the reason KB misses a customer reply.
    if (process.env['GHL_PRE_REPLY_CONTEXT_SYNC'] !== 'false') {
      try {
        this.metrics?.emit({ tenantId, conversationId, eventType: 'ghl_sync_started', eventSource: 'inbound-processor' });
        const syncResult = await syncGhlConversationContext({
          supabase: this.supabase,
          tenantId,
          ghlLocationId: locationId,
          conversationId,
          contactId: ghlContactId,
          onMessageImported: ({ direction, sender, source }) => {
            if (direction === 'OUTBOUND' && sender !== 'AI') {
              this.metrics?.emit({ tenantId, conversationId, eventType: 'ghl_message_imported', eventSource: 'ghl-conversation-sync', metadata: { sender, source } });
            }
          },
        });
        this.metrics?.emit({ tenantId, conversationId, eventType: 'ghl_sync_completed', eventSource: 'inbound-processor', metadata: { fetched: syncResult.synced + syncResult.deduped + syncResult.appSkipped, inserted: syncResult.synced, deduped: syncResult.deduped, appSkipped: syncResult.appSkipped, latencyMs: syncResult.latencyMs } });
      } catch (e) {
        this.metrics?.emit({ tenantId, conversationId, eventType: 'ghl_sync_failed', eventSource: 'inbound-processor', severity: 'error', metadata: { error: e instanceof Error ? e.message : String(e) } });
        this.logger.warn(`context_sync_failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

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
      orchestrationIngressTimings: {
        orchestrateQueueWaitMs: orchestrateQueueWaitMs ?? null,
        debounceConfiguredMs: debounceConfiguredMs ?? null,
      },
    };

    // Orchestration idempotency: acquire atomic Redis lock on latest inbound message
    // to prevent duplicate orchestration when shared ingest + webhook both enqueue jobs.
    const lockToken = await this.tryClaimInboundForOrchestration(tenantId, conversationId);
    if (!lockToken) {
      this.logger.log(
        `Orchestration skipped (already locked/completed): conversationId=${conversationId}`,
      );
      if (webhookEventId) await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
      return;
    }

    const latestMsgId = lockToken === 'empty-claim' ? '' : (await this.fetchLatestInboundOrchestrationContext(conversationId)).id ?? '';
    let result: Awaited<ReturnType<ConversationOrchestrationService['orchestrate']>>;
    try {
      result = await this.orchestrationService.orchestrate(orchestrationInput);
    } catch (error) {
      // A technical orchestration failure must reject the BullMQ job so its
      // configured attempts/backoff are exercised. Release only our owned
      // orchestration claim; do not mark the provider done or webhook complete.
      await this.releaseOrchestrationLock(tenantId, latestMsgId, lockToken);
      throw error;
    }

    if (result.outcome === 'SKIP_HANDOVER_ACTIVE') {
      // Active handover is an intentional silent skip. Record the terminal
      // decision even if the provider id is missing so this never becomes an
      // unknown no-reply.
      const skipStatus = mapOutcomeToDecisionStatus(result.outcome as string);
      if (latestMsgId && skipStatus) {
        await recordTerminalDecision({
          supabase: this.supabase,
          logger: this.logger,
          messageId: latestMsgId,
          decision: {
            status: skipStatus,
            reason: result.outcome,
            triggerSource: 'webhook',
            decidedAt: new Date().toISOString(),
          },
        });
      }
      if (ctxGhlMsgId) {
        await markProviderOrchestrationDone(this.appCache, tenantId, ctxGhlMsgId);
      }
      await this.releaseOrchestrationLock(tenantId, latestMsgId, lockToken);
    } else if (result.outcome === 'PROCEED' && result.replyPlan && result.replyPlan.bubbles.length > 0) {
      const replyId = randomUUID();
      if (result.replyPlan) result.replyPlan.replyId = replyId;
      const latestInboundMsgIdAtStart = (await this.fetchLatestInboundOrchestrationContext(conversationId)).id ?? '';
      const aiJobStartedAt = pipelineWallStartMs;

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
          replyId,
          bubbleSequence: 0,
          latestInboundMsgIdAtStart,
          aiJobStartedAt,
          replyLatencyTrace: { pipelineWallStartMs: pipelineWallStartMs ?? Date.now() },
          providerGhlMessageId: ctxGhlMsgId || undefined,
          inboundMessageId: latestMsgId || undefined,
        });

        this.logger.log(
          `Send-bubble job enqueued: conversationId=${conversationId}, bubbleCount=${result.replyPlan.bubbles.length}`,
        );
      }
      await this.markOrchestrationCompleted(latestMsgId);
      await this.releaseOrchestrationLock(tenantId, latestMsgId, lockToken);
      // Provider done marker is now set in send-bubble.processor.ts after successful send.
      // Record interim pending decision — finalized by send-bubble with PROCEED or FAILED_SEND.
      if (latestMsgId) {
        void recordInterimDecision({
          supabase: this.supabase,
          messageId: latestMsgId,
          decision: {
            status: 'PENDING',
            reason: 'enqueued for send',
            triggerSource: 'webhook',
            decidedAt: new Date().toISOString(),
          },
        });
      }
    } else if (
      result.outcome === 'PROCEED' &&
      result.replyPlan &&
      (result.replyPlan.planStatus === 'HANDOVER' || result.replyPlan.handoverRecommended)
    ) {
      await this.markOrchestrationCompleted(latestMsgId);
      if (latestMsgId) {
        await recordTerminalDecision({
          supabase: this.supabase,
          logger: this.logger,
          messageId: latestMsgId,
          decision: {
            status: 'SKIP_HUMAN_TAKEOVER',
            reason: result.replyPlan.rationale || 'human takeover',
            triggerSource: 'webhook',
            decidedAt: new Date().toISOString(),
          },
        });
      }
      if (ctxGhlMsgId) {
        await markProviderOrchestrationDone(this.appCache, tenantId, ctxGhlMsgId);
      }
      await this.releaseOrchestrationLock(tenantId, latestMsgId, lockToken);
      this.logger.log(
        `Human takeover recorded without outbound bubble: conversationId=${conversationId}, status=${result.replyPlan.planStatus}`,
      );
    } else {
      // Non-PROCEED outcome (e.g. guard blocked) — record terminal decision and release lock
      const skipStatus = mapOutcomeToDecisionStatus(result.outcome as string);
      if (latestMsgId && skipStatus) {
        await recordTerminalDecision({
          supabase: this.supabase,
          logger: this.logger,
          messageId: latestMsgId,
          decision: {
            status: skipStatus,
            reason: result.outcome,
            triggerSource: 'webhook',
            decidedAt: new Date().toISOString(),
          },
        });
        // Mark provider done AFTER terminal decision is recorded
        if (ctxGhlMsgId && ['SKIP_AI_OFF_TAG', 'SKIP_HANDOVER_ACTIVE', 'SKIP_DUPLICATE_PROVIDER_DONE', 'SKIP_HUMAN_TAKEOVER'].includes(skipStatus)) {
          await markProviderOrchestrationDone(this.appCache, tenantId, ctxGhlMsgId);
        }
      }
      await this.releaseOrchestrationLock(tenantId, latestMsgId, lockToken);
    }

    this.logger.log(
      `Orchestration result: conversationId=${conversationId}, outcome=${result.outcome}, ` +
        `routingRecommendedModel=${result.routing?.recommendedModel ?? 'n/a'}, ` +
        `generationModelActuallyUsed=${result.replyPlan?.generationModelActuallyUsed ?? result.replyPlan?.generationModel ?? 'n/a'}`,
    );

    if (webhookEventId) {
      await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
    }
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
    resetDetectionBatch?: string[];
    resetDetectionRows?: Array<{ content: string; created_at: string }>;
  }): Promise<boolean> {
    const latestResetRow =
      params.resetDetectionRows && params.resetDetectionRows.length > 0
        ? params.resetDetectionRows[params.resetDetectionRows.length - 1]
        : null;
    const latestTrimmed = latestResetRow
      ? String(latestResetRow.content ?? '').trim()
      : params.resetDetectionBatch && params.resetDetectionBatch.length > 0
        ? String(params.resetDetectionBatch[params.resetDetectionBatch.length - 1] ?? '').trim()
        : params.recentInboundBatch && params.recentInboundBatch.length > 0
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
      ...(latestResetRow?.created_at ? { resetAtIso: latestResetRow.created_at } : {}),
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

  private async fetchRecentInboundBatches(
    conversationId: string,
    opts?: {
      memoryResetAfterIso?: string | null;
      alwaysIncludeMessageId?: string | null;
    },
  ): Promise<{
    orchestrationBatch: string[];
    resetDetectionBatch: string[];
    resetDetectionRows: Array<{ content: string; created_at: string }>;
  }> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('id, content, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error || !data?.length) {
      return { orchestrationBatch: [], resetDetectionBatch: [], resetDetectionRows: [] };
    }
    const rows = collapseNearbyDuplicateInboundRows(
      data as { id?: string | null; created_at: string; content?: string | null }[],
    );
    const resetDetectionBatch = filterInboundRowsToBurstWindow(rows);
    const resetDetectionRows = buildBurstRowsOldestFirst(rows);
    const resetAfterMs = opts?.memoryResetAfterIso ? Date.parse(opts.memoryResetAfterIso) : NaN;
    const alwaysIncludeMessageId = opts?.alwaysIncludeMessageId?.trim() || null;
    const rowsForOrchestration = Number.isFinite(resetAfterMs)
      ? rows.filter(r => {
          if (alwaysIncludeMessageId && r.id === alwaysIncludeMessageId) return true;
          const rowMs = Date.parse(r.created_at);
          return Number.isFinite(rowMs) && rowMs > resetAfterMs;
        })
      : rows;
    const withoutResetCmd = excludeChatResetInboundRows(rowsForOrchestration);
    const orchestrationBatch = filterInboundRowsToBurstWindow(withoutResetCmd);
    return { orchestrationBatch, resetDetectionBatch, resetDetectionRows };
  }

  /**
   * Acquire an atomic Redis lock to prevent duplicate orchestration for the same
   * inbound message. Uses Redis SET NX with TTL via AppCacheService.
   * Returns the lock owner token if acquired, or null if already locked/completed/unavailable.
   */
  /**
   * Recovery: when webhook lacks ghlMessageId, run a focused GHL sync to
   * discover the real message ID and schedule orchestration through the
   * provider gate with proper identity.
   */
  private async recoverOrchestrationViaSync(
    tenantId: string,
    conversationId: string,
    ghlLocationId: string,
    ghlContactId: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `recovery_sync_started: conversationId=${conversationId}`,
      );
      const syncResult = await syncGhlConversationContext({
        supabase: this.supabase,
        tenantId,
        ghlLocationId,
        conversationId,
        contactId: ghlContactId,
      });

      const hasRecoveredGhlId = !!syncResult.latestRecoveredGhlMessageId;
      const hasRecoveredTs = !!syncResult.latestRecoveredContactInboundAt;

      let recoveredGhlId = syncResult.latestRecoveredGhlMessageId;
      let recoveredTs = syncResult.latestRecoveredContactInboundAt;

      // If sync returned no new inserts, check for stored but uncovered inbound messages
      // (short-circuit case — messages already in DB but never orchestrated)
      if (!syncResult.insertedContactInboundIds.length && !(hasRecoveredGhlId && hasRecoveredTs)) {
        const uncovered = await this.fetchLatestUncoveredInbound(conversationId);
        if (!uncovered) {
          this.logger.log(
            `recovery_sync_no_new_inbound: conversationId=${conversationId}`,
          );
          return;
        }
        this.logger.log(
          `recovery_sync_uncovered_inbound: conversationId=${conversationId} kbMsgId=${(uncovered.id ?? '').slice(0, 8)}`,
        );
        recoveredGhlId = uncovered.ghlMessageId ?? null;
        recoveredTs = uncovered.createdAt ?? null;
      }

      if (syncResult.insertedContactInboundIds.length === 0 && recoveredGhlId && recoveredTs) {
        this.logger.log(
          `recovery_sync_existing_inbound_recovered: conversationId=${conversationId} ghlMessageId=${recoveredGhlId.slice(0, 12)}`,
        );
      }

      // Guard: skip if a later KB outbound already handled this inbound
      if (recoveredTs) {
        const { data: laterOutbound } = await this.supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('direction', 'OUTBOUND')
          .eq('sender', 'AI')
          .gte('created_at', recoveredTs)
          .limit(1)
          .maybeSingle();

        if (laterOutbound) {
          this.logger.log(
            `recovery_sync_later_outbound_exists: conversationId=${conversationId} ` +
            `recoveredAt=${recoveredTs}`,
          );
          return;
        }
      }

      // Schedule orchestration with the recovered GHL message ID
      const recoveryGate = await checkProviderOrchestrationGate({
        appCache: this.appCache,
        logger: this.logger,
        tenantId,
        conversationId,
        ghlMessageId: recoveredGhlId,
        ghlTimestamp: recoveredTs,
        source: 'fallback',
      });

      if (!recoveryGate.allowed) {
        this.logger.log(
          `recovery_sync_gate_blocked: conversationId=${conversationId} reason=${recoveryGate.reason}`,
        );
        return;
      }

      // Bump debounce + schedule orchestration
      const { data: convMetaRow } = await this.supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single();
      const currentMeta = readConversationMetadataField(convMetaRow?.metadata);
      const { merged: debounceBump, newVersion } = bumpInboundDebounceMeta(currentMeta);
      const merged = mergeConversationMetadataForPersist(currentMeta, debounceBump);
      await this.supabase
        .from('conversations')
        .update({ metadata: merged, updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      const { debounceMs } = resolveInboundDebounceMs();
      await this.inboundQueue.add(
        'orchestrate',
        {
          tenantId, conversationId, locationId: ghlLocationId, ghlContactId,
          ghlConversationId: '', debounceVersion: newVersion,
          debounceConfiguredMs: debounceMs, orchestrateEnqueuedAtMs: Date.now(),
          ghlInboundMessageId: recoveredGhlId || undefined,
        } satisfies OrchestrateDebouncedJobData,
        {
          delay: debounceMs,
          jobId: `deb:${conversationId}:${newVersion}`,
          attempts: 2, backoff: { type: 'exponential', delay: 1500 }, removeOnComplete: true,
        },
      );

      this.logger.log(
        `recovery_sync_orch_scheduled: conversationId=${conversationId} providerMsgId=${(recoveredGhlId || '').slice(0, 12)}`,
      );
    } catch (err) {
      this.logger.warn(
        `recovery_sync_failed: conversationId=${conversationId} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Check for stored CONTACT/INBOUND messages that have no later OUTBOUND/AI reply.
   * Used by recovery sync when the GHL sync short-circuits but messages were already
   * stored in the DB without being orchestrated.
   */
  private async fetchLatestUncoveredInbound(conversationId: string): Promise<{
    id: string;
    ghlMessageId: string | null;
    createdAt: string | null;
  } | null> {
    // Fetch the latest few CONTACT/INBOUND messages and prefer one with a ghlMessageId.
    // Webhook duplicates (no ghlMessageId) can be the latest entry but can't satisfy
    // the provider gate, so we skip them in favor of the sync entry that has the real ID.
    const { data: recentInbounds } = await this.supabase
      .from('messages')
      .select('id, metadata, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .order('created_at', { ascending: false })
      .limit(5);

    if (!recentInbounds?.length) return null;

    // Prefer the message WITH a ghlMessageId
    let bestInbound: Record<string, unknown> | null = null;
    for (const row of recentInbounds) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const hasGhlId = typeof meta['ghlMessageId'] === 'string' && meta['ghlMessageId'].trim();
      const createdAt = typeof row.created_at === 'string' ? row.created_at : null;

      // Check if a later outbound already exists for this message
      if (createdAt) {
        const { data: laterOutbound } = await this.supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('direction', 'OUTBOUND')
          .eq('sender', 'AI')
          .gte('created_at', createdAt)
          .limit(1)
          .maybeSingle();

        if (laterOutbound) continue; // already handled
      }

      if (hasGhlId) {
        bestInbound = row as Record<string, unknown>;
        break; // prefer first match with ghlMessageId
      }
      // Fallback: use the latest even without ghlMessageId (will likely fail provider gate)
      if (!bestInbound) bestInbound = row as Record<string, unknown>;
    }

    if (!bestInbound) return null;
    const meta = (bestInbound['metadata'] ?? {}) as Record<string, unknown>;
    return {
      id: bestInbound['id'] as string,
      ghlMessageId: typeof meta['ghlMessageId'] === 'string' ? meta['ghlMessageId'] : null,
      createdAt: typeof bestInbound['created_at'] === 'string' ? bestInbound['created_at'] : null,
    };
  }

  private async tryClaimInboundForOrchestration(tenantId: string, conversationId: string): Promise<string | null> {
    const latest = await this.fetchLatestInboundOrchestrationContext(conversationId);
    if (!latest.id) {
      // No inbound message to claim — allow orchestration (empty conversation)
      return 'empty-claim';
    }

    // Check: already completed?
    if (latest.metadata?.['orchestrationCompletedAt']) {
      return null;
    }

    // Atomic Redis lock — Redis unavailable means skip to avoid duplicate replies
    if (!this.appCache) {
      this.logger.warn(
        `Orchestration skipped (no cache): conversationId=${conversationId}`,
      );
      return null;
    }

    const lockKey = `lock:orch:${tenantId}:${latest.id}`;
    const ownerToken = randomUUID();
    const result = await this.appCache.acquireLock(lockKey, ownerToken, 120);

    if (result === 'acquired') {
      return ownerToken;
    }

    if (result === 'held') {
      this.logger.log(
        `Orchestration skipped (lock held): conversationId=${conversationId} messageId=${latest.id.slice(0, 8)}`,
      );
      return null;
    }

    // 'unavailable' — Redis down, skip to prevent duplicate replies
    this.logger.warn(
      `Orchestration skipped (lock unavailable): conversationId=${conversationId}`,
    );
    return null;
  }

  private async releaseOrchestrationLock(tenantId: string, messageId: string, ownerToken: string): Promise<void> {
    if (!messageId || messageId === 'empty-claim' || !ownerToken || !this.appCache) return;
    const lockKey = `lock:orch:${tenantId}:${messageId}`;
    await this.appCache.releaseLock(lockKey, ownerToken);
  }

  private async markOrchestrationCompleted(messageId: string): Promise<void> {
    if (!messageId || messageId === 'empty-claim') return;
    const now = new Date().toISOString();
    try {
      // Read current metadata to merge (not replace) — preserves ghlMessageId, fingerprint, etc.
      const { data: msg } = await this.supabase
        .from('messages')
        .select('metadata')
        .eq('id', messageId)
        .maybeSingle();
      const meta = (msg?.metadata ?? {}) as Record<string, unknown>;
      meta['orchestrationCompletedAt'] = now;
      const { error } = await this.supabase
        .from('messages')
        .update({ metadata: meta })
        .eq('id', messageId);
      if (error) {
        this.logger.warn(
          `markOrchestrationCompleted_write_failed: messageId=${messageId.slice(0, 8)} error=${error.message}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `markOrchestrationCompleted_exception: messageId=${messageId.slice(0, 8)} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async fetchLatestInboundOrchestrationContext(conversationId: string): Promise<{
    id: string | null;
    messageType: InboundMessageJobData['messageType'];
    imageMediaUrl: string | null;
    preferredMessageId: string | null;
    metadata: Record<string, unknown>;
  }> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('id, content, contentType, metadata')
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      return { id: null, messageType: 'text', imageMediaUrl: null, preferredMessageId: null, metadata: {} };
    }
    const id = typeof data.id === 'string' ? data.id : null;
    const content = typeof data.content === 'string' ? data.content : '';
    const ct = String(data.contentType ?? 'TEXT').toUpperCase();
    let messageType: InboundMessageJobData['messageType'] =
      ct === 'IMAGE' ? 'image' : ct === 'AUDIO' ? 'audio' : ct === 'VIDEO' ? 'video' : 'text';
    if (messageType === 'text' && (ghlBodyIndicatesImagePlaceholder(content) || isInboundImagePlaceholderContent(content))) {
      messageType = 'image';
    }
    const meta =
      data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};
    const imageMediaUrl =
      typeof meta['imageMediaUrl'] === 'string' && meta['imageMediaUrl'].trim()
        ? meta['imageMediaUrl'].trim()
        : null;
    const preferredMessageId =
      typeof meta['ghlInboundMessageId'] === 'string' && meta['ghlInboundMessageId'].trim()
        ? meta['ghlInboundMessageId'].trim()
        : null;
    return { id, messageType, imageMediaUrl, preferredMessageId, metadata: meta };
  }

  private async fetchRecentStoredInboundImageUrl(conversationId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('metadata, contentType, content')
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error || !data?.length) return null;
    for (const row of data) {
      const meta =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const url =
        typeof meta['imageMediaUrl'] === 'string' && meta['imageMediaUrl'].trim()
          ? meta['imageMediaUrl'].trim()
          : null;
      if (url) return url;
      const ct = String(row.contentType ?? '').toUpperCase();
      const content = typeof row.content === 'string' ? row.content : '';
      if (ct === 'IMAGE' || ghlBodyIndicatesImagePlaceholder(content) || isInboundImagePlaceholderContent(content)) {
        continue;
      }
    }
    return null;
  }

  private async resolveOrchestrationImageUrl(params: {
    tenantId: string;
    conversationId: string;
    locationId: string;
    ghlConversationId: string;
    ghlContactId: string;
    latestInboundMessageType: InboundMessageJobData['messageType'];
    latestInboundText: string;
    latestInboundImageUrl: string | null;
    preferredMessageId?: string | null;
    inboundWebhookTimestampIso: string;
  }): Promise<string | null> {
    const existing = params.latestInboundImageUrl?.trim();
    if (existing) return existing;

    const asksAboutRecentPhoto = userAsksAboutRecentPhotoContent(params.latestInboundText);
    if (asksAboutRecentPhoto) {
      const stored = await this.fetchRecentStoredInboundImageUrl(params.conversationId);
      if (stored) return stored;
    }

    const imageTurn =
      params.latestInboundMessageType === 'image' ||
      isInboundImagePlaceholderContent(params.latestInboundText) ||
      ghlBodyIndicatesImagePlaceholder(params.latestInboundText) ||
      asksAboutRecentPhoto;
    if (!imageTurn || !params.locationId.trim()) {
      return null;
    }
    const canDiscover =
      Boolean(params.preferredMessageId?.trim()) ||
      Boolean(params.ghlConversationId.trim()) ||
      Boolean(params.ghlContactId.trim());
    if (!canDiscover) {
      return null;
    }
    if (process.env['GHL_IMAGE_DISCOVER_MEDIA_URL'] === 'false') {
      return null;
    }

    const conversationId = await this.resolveGhlConversationIdForImageDiscovery({
      tenantId: params.tenantId,
      locationId: params.locationId,
      ghlConversationId: params.ghlConversationId,
      ghlContactId: params.ghlContactId,
    });

    const discovered = await this.ghlVoiceMessageDiscovery.discoverInboundImageMediaUrl({
      tenantId: params.tenantId,
      locationId: params.locationId,
      ...(conversationId ? { conversationId } : {}),
      webhookTimestampIso: params.inboundWebhookTimestampIso,
      preferredMessageId: params.preferredMessageId?.trim() || undefined,
    });
    if (discovered.ok) {
      this.logger.log(
        JSON.stringify({
          orchestrationImageDiscoverySucceeded: true,
          candidateCount: discovered.candidateCount,
        }),
      );
      return discovered.imageMediaUrl;
    }
    this.logger.warn(
      JSON.stringify({
        orchestrationImageDiscoveryFailed: true,
        reason: discovered.reason,
        candidateCount: discovered.candidateCount ?? 0,
      }),
    );
    return null;
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
  private async refreshConversationChannel(
    conversationId: string,
    norm: ReturnType<typeof resolveGhlInboundChannel>,
    locationId: string,
  ): Promise<void> {
    const { data: row } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    const prevMeta =
      row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const incoming = {
      ghlChannelRaw: norm.raw,
      ghlOutboundChannel: norm.outboundChannel,
      ghlChannelSource: norm.source,
      channelIdentity: norm.identityChannel,
      locationId,
    };
    const merged = mergeConversationMetadataForPersist(prevMeta, incoming);
    const { error } = await this.supabase
      .from('conversations')
      .update({
        channel: norm.dbChannel,
        metadata: merged,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    if (error) {
      this.logger.warn(
        `Failed to refresh conversation channel ${conversationId}: ${formatPostgrestError(error)}`,
      );
    }
  }

  private async getOrCreateConversation(
    tenantId: string,
    ghlConversationId: string,
    contactId: string,
    timestamp: string,
    locationId: string,
    channelHints?: {
      channelRaw?: string;
      ghlMessageTypeRaw?: string;
      contactPhone?: string;
      workflowFlatRaw?: Record<string, unknown>;
    },
  ): Promise<{ id: string; reused: boolean; derivedKeyHash: string }> {
    const norm = resolveGhlInboundChannel({
      channelRaw: channelHints?.channelRaw,
      messageTypeRaw: channelHints?.ghlMessageTypeRaw,
      contactPhone: channelHints?.contactPhone,
      workflowFlatRaw: channelHints?.workflowFlatRaw,
    });

    // Normalize phone-formatted contact IDs to GHL internal IDs before identity
    // derivation so conversations are consistently matched by stable identifiers.
    const resolved = await resolveContactIdIfPhone(this.supabase, tenantId, locationId, contactId);
    const effectiveContactId = resolved.resolvedContactId;

    const identity = deriveConversationIdentity({
      tenantId,
      channel: norm.identityChannel,
      externalContactId: effectiveContactId,
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

    // 2b) If we resolved a phone → GHL internal ID, also try the original phone-derived
    // key. An existing conversation may have been created with the phone-derived key before
    // this normalization was implemented. If found, upgrade it to use the resolved IDs.
    if (resolved.wasResolved) {
      const phoneDerivedKey = `aisbp:conv:${identity.channel}:${tenantId}:${resolved.originalContactId}`;
      const { data: phoneExisting } = await this.supabase
        .from('conversations')
        .select('id, contact_id')
        .eq('tenant_id', tenantId)
        .eq('ghl_conversation_id', phoneDerivedKey)
        .maybeSingle();
      if (phoneExisting) {
        // Upgrade the existing conversation: use resolved GHL ID for contact_id
        // and the new derived key for ghl_conversation_id.
        const { error: upErr } = await this.supabase
          .from('conversations')
          .update({
            contact_id: effectiveContactId,
            ghl_conversation_id: identity.derivedConversationKey,
            updated_at: new Date().toISOString(),
          })
          .eq('id', phoneExisting.id);
        if (upErr) {
          this.logger.warn(`contactResolveUpgradeFailed: ${formatPostgrestError(upErr)}`);
        } else {
          this.logger.log(
            `contactResolveUpgraded: convId=${phoneExisting.id} ${resolved.originalContactId} → ${effectiveContactId}`,
          );
        }
        safeLog(true, phoneExisting.id, 'phone_derived_key_upgraded');
        return { id: phoneExisting.id, reused: true, derivedKeyHash: identity.derivedKeyHash };
      }
    }

    // 3) Fallback: legacy rows for the same (tenant, contact, channel) — pick the most recent.
    const { data: legacyMatches } = await this.supabase
      .from('conversations')
      .select('id, ghl_conversation_id, last_message_at, metadata')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .eq('channel', norm.dbChannel)
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
        ghlChannelRaw: norm.raw,
        ghlOutboundChannel: norm.outboundChannel,
        locationId,
        ...(identity.externalConversationId
          ? { externalConversationId: identity.externalConversationId }
          : {}),
      };
      const mergedSafe = mergeConversationMetadataForPersist(prevMeta, merged);
      const ghlIdToWrite = identity.externalConversationId ?? identity.derivedConversationKey;
      const { error: upErr } = await this.supabase
        .from('conversations')
        .update({
          ghl_conversation_id: ghlIdToWrite,
          channel: norm.dbChannel,
          metadata: mergedSafe,
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
      externalContactId: effectiveContactId,
      channel: identity.channel,
      ghlChannelRaw: norm.raw,
      ghlOutboundChannel: norm.outboundChannel,
      locationId,
      createdFromTimestamp: timestamp,
      ...(resolved.wasResolved
        ? { originalContactId: resolved.originalContactId, contactResolvedAt: new Date().toISOString() }
        : {}),
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
        contact_id: effectiveContactId,
        channel: norm.dbChannel,
        status: 'ACTIVE',
        last_message_at: now,
        updated_at: now,
        metadata,
      })
      .select('id')
      .single();

    if (error || !data) {
      const dupCode = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
      if (dupCode === '23505') {
        const { data: existing } = await this.supabase
          .from('conversations')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('ghl_conversation_id', ghlIdToWrite)
          .maybeSingle();
        if (existing?.id) {
          safeLog(true, existing.id, 'create_race_reused');
          return { id: existing.id, reused: true, derivedKeyHash: identity.derivedKeyHash };
        }
      }
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
    tenantId: string,
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
      tenant_id: tenantId,
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
      if (status === 'ORCHESTRATING' && this.isUnknownWebhookStatusError(error)) {
        const { error: fallbackErr } = await this.supabase
          .from('webhook_events')
          .update({ ...updateData, processing_status: 'PROCESSING' })
          .eq('id', webhookEventRowId);
        if (fallbackErr) {
          this.logger.warn(
            `Webhook event status fallback failed (id=${webhookEventRowId}): ${formatPostgrestError(fallbackErr)}`,
          );
        }
        return;
      }
      this.logger.warn(`Webhook event status update failed (id=${webhookEventRowId}): ${formatPostgrestError(error)}`);
    }
  }

  /** True when DB enum has not yet picked up ORCHESTRATING/SKIPPED migration values. */
  private isUnknownWebhookStatusError(error: unknown): boolean {
    const msg = formatPostgrestError(error).toLowerCase();
    return msg.includes('invalid input value') || msg.includes('webhookprocessingstatus');
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
