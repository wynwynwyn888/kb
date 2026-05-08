import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { getSupabaseService } from '../../lib/supabase';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { QUEUES } from '../../queues/queue.constants';
import type { ReplyDecision } from '../reply-planning/dto';
import { HumanEscalationRuntimeService } from './human-escalation-runtime.service';
import {
  HumanEscalationHandoverReplyService,
  buildRecentConversationContextForHandover,
  type HandoverActiveReplyType,
  isNearDuplicate,
} from './human-escalation-handover-reply.service';
import { ConversationMemoryLoader } from '../orchestration/conversation-memory-loader';
import { parseAisbpPolicyState } from '../conversation-policy/conversation-policy-state';

/** Base cooldown: do not send more than one holding reply within 2 minutes. */
const HOLDING_REPLY_BASE_COOLDOWN_MS = 2 * 60 * 1000;

/** Internal update throttle: at most one staff update every 10 minutes after handover. */
const INTERNAL_UPDATE_COOLDOWN_MS = 10 * 60 * 1000;

const METADATA_LAST_HOLDING_SENT_AT = 'humanEscalationLastHoldingReplySentAt';
const METADATA_LAST_HOLDING_TYPE = 'humanEscalationLastHoldingReplyType';
const METADATA_LAST_HOLDING_TEXT = 'humanEscalationLastHoldingReplyText';

function normalizeAckOnlyText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u2019’]/g, "'")
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAcknowledgementOnly(raw: string): boolean {
  const t0 = raw.trim();
  if (!t0) return true;
  // If there is a question or any substantive punctuation, do not suppress.
  if (/[?]/.test(t0)) return false;

  const t = normalizeAckOnlyText(t0);
  if (!t) return true;

  const ack = new Set([
    'ok',
    'okay',
    'sure',
    'thanks',
    'thank you',
    'noted',
    'alright',
    'got it',
    'tq',
    'thx',
    'ok thanks',
    'okay thanks',
    'sure thanks',
  ]);
  return ack.has(t);
}

@Injectable()
export class HumanEscalationHoldingReplyService {
  private readonly logger = new Logger(HumanEscalationHoldingReplyService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.SEND_BUBBLE) private readonly sendBubbleQueue: Queue,
    private readonly humanEscalationRuntime: HumanEscalationRuntimeService,
    private readonly handoverReply: HumanEscalationHandoverReplyService,
    private readonly memoryLoader: ConversationMemoryLoader,
  ) {}

  /**
   * Deterministic responder while handover is active:
   * - chooses reply type based on the latest inbound message (no AI generation / no KB)
   * - respects cooldown with a waiting-time override
   * - optionally sends an internal update on a separate 10-minute throttle
   */
  async tryEnqueueHoldingReply(params: {
    tenantId: string;
    conversationId: string;
    locationId: string;
    ghlContactId: string;
    latestInboundText: string;
    contactDisplayName?: string | null;
    contactPhone?: string | null;
    botMode?: string | null;
    pipelineWallStartMs?: number | null;
  }): Promise<void> {
    const {
      tenantId,
      conversationId,
      locationId,
      ghlContactId,
      latestInboundText,
      contactDisplayName,
      contactPhone,
      botMode,
      pipelineWallStartMs,
    } = params;

    if (isAcknowledgementOnly(latestInboundText)) {
      this.logger.log(
        `humanEscalationHoldingReplySuppressed ${JSON.stringify({
          conversationId,
          tenantId,
          reason: 'acknowledgement_only',
        })}`,
      );
      return;
    }

    // Internal update (staff) — throttled and independent of customer cooldown.
    void this.trySendInternalUpdateIfEligible({
      tenantId,
      conversationId,
      contactId: ghlContactId,
      latestInboundText,
      contactDisplayName,
      contactPhone,
    }).catch((e: unknown) => {
      this.logger.warn(
        `humanEscalationInternalUpdateFailed ${JSON.stringify({
          conversationId,
          tenantId,
          message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        })}`,
      );
    });

    if ((botMode ?? 'autopilot') === 'suggestive') {
      this.logger.log(
        `humanEscalationHoldingReplySuppressed ${JSON.stringify({
          conversationId,
          tenantId,
          reason: 'suggestive_mode',
        })}`,
      );
      return;
    }

    const { lastSentAtIso, lastType, lastText } = await this.readLastHoldingMeta(conversationId);
    const now = Date.now();
    const lastSentAtMs = lastSentAtIso ? Date.parse(lastSentAtIso) : Number.NaN;
    const elapsed = Number.isNaN(lastSentAtMs) ? null : Math.max(0, now - lastSentAtMs);

    let recentConversationContext = '';
    try {
      const { data: convMeta } = await this.supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .maybeSingle();
      const policy = parseAisbpPolicyState(convMeta?.metadata as Record<string, unknown> | undefined);
      const memory = await this.memoryLoader.loadMemory(conversationId, {
        memoryResetAfterIso: policy.memoryResetAt ?? null,
      });
      recentConversationContext = buildRecentConversationContextForHandover(memory.entries, latestInboundText);
    } catch (e) {
      this.logger.warn(
        `humanEscalationHandoverRecentContextFailed ${JSON.stringify({
          conversationId,
          tenantId,
          message: e instanceof Error ? e.message.slice(0, 160) : String(e),
        })}`,
      );
    }

    const ai = await this.handoverReply.classifyAndCompose({
      tenantId,
      conversationId,
      latestInboundText,
      recentConversationContext,
    });

    const selected = ai.selectedType;
    const text = ai.replyText;

    // Base cooldown: suppress repeated replies within 2 minutes.
    if (elapsed !== null && elapsed < HOLDING_REPLY_BASE_COOLDOWN_MS) {
      const sameType = Boolean(lastType && selected === lastType);
      const nearDup = sameType && lastText ? isNearDuplicate(lastText, text) : false;

      // Rule: suppress identical type within cooldown (plus near-duplicate only when type is same).
      if (sameType || nearDup) {
        const waitSec = Math.ceil((HOLDING_REPLY_BASE_COOLDOWN_MS - elapsed) / 1000);
        this.logger.log(
          `humanEscalationHoldingReplySuppressed ${JSON.stringify({
            conversationId,
            tenantId,
            holdingReplyType: selected,
            lastHoldingReplyType: lastType ?? null,
            cooldownRemainingSec: waitSec,
            reason: sameType ? 'same_type_within_cooldown' : 'near_duplicate_within_cooldown',
          })}`,
        );
        return;
      }

      // Rule: frustration is always allowed once inside cooldown unless last was frustration.
      // Rule: semantic type change is allowed inside cooldown.
      this.logger.log(
        `humanEscalationHoldingReplyCooldownBypassed ${JSON.stringify({
          tenantId,
          conversationId,
          fromType: lastType ?? null,
          toType: selected,
          reason: selected === 'frustration' ? 'frustration_allowed' : 'semantic_type_changed',
        })}`,
      );
    }

    const plan: ReplyDecision = {
      planStatus: 'PLANNED',
      responseMode: 'handover',
      handoverRecommended: true,
      confidence: 0.95,
      rationale: `human_escalation_holding_reply:${selected}`,
      bubbles: [{ index: 0, text }],
      suggestedActions: [],
      draftProvenance: 'human_escalation',
    };

    await this.sendBubbleQueue.add('send-bubble', {
      conversationId,
      tenantId,
      contactId: ghlContactId,
      ghlLocationId: locationId,
      replyPlanJson: JSON.stringify(plan),
      replyLatencyTrace: { pipelineWallStartMs: pipelineWallStartMs ?? Date.now() },
    });

    await this.persistLastHoldingMeta(conversationId, selected, text);

    this.logger.log(
      `humanEscalationHoldingReplySent ${JSON.stringify({
        conversationId,
        tenantId,
        holdingReplyType: selected,
      })}`,
    );
  }

  private async readLastHoldingMeta(conversationId: string): Promise<{
    lastSentAtIso: string | null;
    lastType: HandoverActiveReplyType | null;
    lastText: string | null;
  }> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data?.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
      return { lastSentAtIso: null, lastType: null, lastText: null };
    }
    const md = data.metadata as Record<string, unknown>;
    const at = md[METADATA_LAST_HOLDING_SENT_AT];
    const ty = md[METADATA_LAST_HOLDING_TYPE];
    const tx = md[METADATA_LAST_HOLDING_TEXT];
    const lastSentAtIso = typeof at === 'string' && at.trim() ? at.trim() : null;
    const lastType =
      ty === 'default' || ty === 'waiting_time' || ty === 'extra_context' || ty === 'frustration'
        ? (ty as HandoverActiveReplyType)
        : null;
    const lastText = typeof tx === 'string' && tx.trim() ? tx.trim() : null;
    return { lastSentAtIso, lastType, lastText };
  }

  private async persistLastHoldingMeta(
    conversationId: string,
    holdingReplyType: HandoverActiveReplyType,
    holdingReplyText: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data) return;
    const prev =
      data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};
    const merged = {
      ...prev,
      [METADATA_LAST_HOLDING_SENT_AT]: new Date().toISOString(),
      [METADATA_LAST_HOLDING_TYPE]: holdingReplyType,
      [METADATA_LAST_HOLDING_TEXT]: holdingReplyText.slice(0, 600),
    };
    const { error: upErr } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (upErr) {
      this.logger.warn(
        `humanEscalationHoldingMetadataPersistFailed ${JSON.stringify({
          conversationId,
          message: formatPostgrestError(upErr),
        })}`,
      );
    }
  }

  private async trySendInternalUpdateIfEligible(params: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    latestInboundText: string;
    contactDisplayName?: string | null;
    contactPhone?: string | null;
  }): Promise<void> {
    const { tenantId, conversationId, contactId, latestInboundText, contactDisplayName, contactPhone } = params;
    try {

    // Read metadata timestamps directly to avoid coupling on other services’ private state.
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    const md =
      !error && data?.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};

    const lastAlertAt = typeof md['humanEscalationInternalAlertSentAt'] === 'string' ? (md['humanEscalationInternalAlertSentAt'] as string) : null;
    const lastUpdateAt =
      typeof md['humanEscalationLastInternalUpdateSentAt'] === 'string'
        ? (md['humanEscalationLastInternalUpdateSentAt'] as string)
        : null;

    const mostRecentIso = lastUpdateAt?.trim() || lastAlertAt?.trim() || null;
    if (!mostRecentIso) return;

    const mostRecentMs = Date.parse(mostRecentIso);
    if (Number.isNaN(mostRecentMs)) return;
    const elapsed = Date.now() - mostRecentMs;
    if (elapsed < INTERNAL_UPDATE_COOLDOWN_MS) {
      const remainingSec = Math.ceil((INTERNAL_UPDATE_COOLDOWN_MS - elapsed) / 1000);
      this.logger.log(
        `humanEscalationInternalUpdateSuppressed ${JSON.stringify({
          conversationId,
          tenantId,
          cooldownRemainingSec: remainingSec,
        })}`,
      );
      return;
    }

    const outcome = await this.humanEscalationRuntime.sendInternalUpdateDuringActiveHandover({
      tenantId,
      conversationId,
      contactId,
      latestInboundMessage: latestInboundText,
      contactDisplayName,
      contactPhone,
    });
    if (outcome === 'sent') {
      this.logger.log(
        `humanEscalationInternalUpdateSent ${JSON.stringify({
          conversationId,
          tenantId,
        })}`,
      );
    } else if (outcome === 'suppressed') {
      this.logger.log(
        `humanEscalationInternalUpdateSuppressed ${JSON.stringify({
          conversationId,
          tenantId,
          reason: 'runtime_suppressed',
        })}`,
      );
    }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `humanEscalationInternalUpdateFailed ${JSON.stringify({
          conversationId,
          tenantId,
          message: msg.slice(0, 220),
        })}`,
      );
    }
  }
}
