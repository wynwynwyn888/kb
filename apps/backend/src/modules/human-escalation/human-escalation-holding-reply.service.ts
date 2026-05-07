import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { getSupabaseService } from '../../lib/supabase';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { QUEUES } from '../../queues/queue.constants';
import type { ReplyDecision } from '../reply-planning/dto';
import { HumanEscalationRuntimeService } from './human-escalation-runtime.service';

/** Base cooldown: do not send more than one holding reply within 2 minutes. */
const HOLDING_REPLY_BASE_COOLDOWN_MS = 2 * 60 * 1000;

/** Internal update throttle: at most one staff update every 10 minutes after handover. */
const INTERNAL_UPDATE_COOLDOWN_MS = 10 * 60 * 1000;

const HOLDING_TEXT_DEFAULT = 'A team member has been notified and will attend to you soon.';
const HOLDING_TEXT_WAITING_TIME =
  "I'm sorry for the wait. Your request has already been sent to the team. I don't have their exact response time here, but a team member will attend to you as soon as they’re available.";
const HOLDING_TEXT_EXTRA_CONTEXT =
  "Thank you. I'll leave this here for the team to review, so they have the full context when they take over.";

const METADATA_LAST_HOLDING_SENT_AT = 'humanEscalationLastHoldingReplySentAt';
const METADATA_LAST_HOLDING_TYPE = 'humanEscalationLastHoldingReplyType';

export type HumanEscalationHoldingReplyType = 'default' | 'waiting_time' | 'extra_context';

@Injectable()
export class HumanEscalationHoldingReplyService {
  private readonly logger = new Logger(HumanEscalationHoldingReplyService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.SEND_BUBBLE) private readonly sendBubbleQueue: Queue,
    private readonly humanEscalationRuntime: HumanEscalationRuntimeService,
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

    // Internal update (staff) — throttled and independent of customer cooldown.
    await this.trySendInternalUpdateIfEligible({
      tenantId,
      conversationId,
      contactId: ghlContactId,
      latestInboundText,
      contactDisplayName,
      contactPhone,
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

    const selected = selectHoldingReplyType(latestInboundText);
    this.logger.log(
      `humanEscalationHoldingReplyTypeSelected ${JSON.stringify({
        conversationId,
        tenantId,
        holdingReplyType: selected,
      })}`,
    );

    const { lastSentAtIso, lastType } = await this.readLastHoldingMeta(conversationId);
    const now = Date.now();
    const lastSentAtMs = lastSentAtIso ? Date.parse(lastSentAtIso) : Number.NaN;
    const elapsed = Number.isNaN(lastSentAtMs) ? null : Math.max(0, now - lastSentAtMs);

    // Base cooldown: suppress repeated replies within 2 minutes.
    // Exception: allow a waiting-time reply after a default reply, even within cooldown, unless
    // we already sent a waiting-time reply recently (avoid spamming identical messages).
    if (elapsed !== null && elapsed < HOLDING_REPLY_BASE_COOLDOWN_MS) {
      const canOverride =
        selected === 'waiting_time' &&
        lastType === 'default' &&
        // Only override if last sent wasn't waiting_time (tracked by type) — else suppress.
        true;

      const identicalSuppression = selected === lastType;
      if (!canOverride || identicalSuppression) {
        const waitSec = Math.ceil((HOLDING_REPLY_BASE_COOLDOWN_MS - elapsed) / 1000);
        this.logger.log(
          `humanEscalationHoldingReplySuppressed ${JSON.stringify({
            conversationId,
            tenantId,
            holdingReplyType: selected,
            lastHoldingReplyType: lastType ?? null,
            cooldownRemainingSec: waitSec,
            reason: identicalSuppression ? 'identical_within_cooldown' : 'cooldown',
          })}`,
        );
        return;
      }
    }

    const text = holdingTextForType(selected);

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

    await this.persistLastHoldingMeta(conversationId, selected);

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
    lastType: HumanEscalationHoldingReplyType | null;
  }> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data?.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
      return { lastSentAtIso: null, lastType: null };
    }
    const md = data.metadata as Record<string, unknown>;
    const at = md[METADATA_LAST_HOLDING_SENT_AT];
    const ty = md[METADATA_LAST_HOLDING_TYPE];
    const lastSentAtIso = typeof at === 'string' && at.trim() ? at.trim() : null;
    const lastType =
      ty === 'default' || ty === 'waiting_time' || ty === 'extra_context' ? (ty as HumanEscalationHoldingReplyType) : null;
    return { lastSentAtIso, lastType };
  }

  private async persistLastHoldingMeta(
    conversationId: string,
    holdingReplyType: HumanEscalationHoldingReplyType,
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
  }
}

function holdingTextForType(t: HumanEscalationHoldingReplyType): string {
  if (t === 'waiting_time') return HOLDING_TEXT_WAITING_TIME;
  if (t === 'extra_context') return HOLDING_TEXT_EXTRA_CONTEXT;
  return HOLDING_TEXT_DEFAULT;
}

function normalizeForMatch(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function selectHoldingReplyType(latestInboundText: string): HumanEscalationHoldingReplyType {
  const t = normalizeForMatch(latestInboundText);
  if (!t) return 'default';

  const waitingTime =
    /\bhow long\b/.test(t) ||
    /\bwhen (will|do) (you|they) (reply|respond)\b/.test(t) ||
    /\bwhen (can|will) (someone|a team member|the team) (reply|respond)\b/.test(t) ||
    /\bstill waiting\b/.test(t) ||
    /\bwhy (no|not) reply\b/.test(t) ||
    /\bno reply\b/.test(t) ||
    /\byou there\b/.test(t) ||
    /\banyone there\b/.test(t) ||
    /\bhello\??$/.test(t) ||
    /\brespond\??$/.test(t);
  if (waitingTime) return 'waiting_time';

  const addsInfoSignals =
    t.length >= 28 ||
    /\b(details|more info|for context|just to add|additional|also|by the way)\b/.test(t) ||
    /\b(my|the) (problem|issue|complaint)\b/.test(t) ||
    /\bbooking\b|\bappointment\b|\breserv(e|ation)\b/.test(t) ||
    /\bphoto\b|\bpicture\b|\bimage\b|\battached\b/.test(t) ||
    /\b(ref|reference|order|invoice|id)\b/.test(t) ||
    /\d{2,}/.test(t);
  if (addsInfoSignals) return 'extra_context';

  return 'default';
}
