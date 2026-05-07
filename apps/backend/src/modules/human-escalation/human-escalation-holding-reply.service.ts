import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { getSupabaseService } from '../../lib/supabase';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { QUEUES } from '../../queues/queue.constants';
import type { ReplyDecision } from '../reply-planning/dto';

/** Cooldown between automated holding replies while handover is active (2–5 min range). */
const HOLDING_REPLY_COOLDOWN_MS = 3 * 60 * 1000;

const HOLDING_TEXT = 'A team member has been notified and will attend to you soon.';

const METADATA_LAST_HOLDING_SENT_AT = 'humanEscalationLastHoldingReplySentAt';

@Injectable()
export class HumanEscalationHoldingReplyService {
  private readonly logger = new Logger(HumanEscalationHoldingReplyService.name);
  private readonly supabase = getSupabaseService();

  constructor(@InjectQueue(QUEUES.SEND_BUBBLE) private readonly sendBubbleQueue: Queue) {}

  /**
   * Builds a deterministic holding reply plan and enqueues send-bubble, unless cooldown applies.
   */
  async tryEnqueueHoldingReply(params: {
    tenantId: string;
    conversationId: string;
    locationId: string;
    ghlContactId: string;
    botMode?: string | null;
    pipelineWallStartMs?: number | null;
  }): Promise<void> {
    const { tenantId, conversationId, locationId, ghlContactId, botMode, pipelineWallStartMs } = params;

    const lastIso = await this.readLastHoldingSentAt(conversationId);
    if (typeof lastIso === 'string' && lastIso.trim()) {
      const elapsed = Date.now() - Date.parse(lastIso);
      if (!Number.isNaN(elapsed) && elapsed >= 0 && elapsed < HOLDING_REPLY_COOLDOWN_MS) {
        const waitSec = Math.ceil((HOLDING_REPLY_COOLDOWN_MS - elapsed) / 1000);
        this.logger.log(
          `humanEscalationHoldingReplySuppressed ${JSON.stringify({
            conversationId,
            tenantId,
            cooldownRemainingSec: waitSec,
          })}`,
        );
        return;
      }
    }

    if ((botMode ?? 'autopilot') === 'suggestive') {
      this.logger.log(
        `humanEscalationHoldingReplySkipped ${JSON.stringify({
          conversationId,
          reason: 'suggestive_mode',
        })}`,
      );
      return;
    }

    const plan: ReplyDecision = {
      planStatus: 'PLANNED',
      responseMode: 'handover',
      handoverRecommended: true,
      confidence: 0.95,
      rationale: 'human_escalation_holding_reply',
      bubbles: [{ index: 0, text: HOLDING_TEXT }],
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

    await this.persistLastHoldingSentAt(conversationId);

    this.logger.log(
      `humanEscalationHoldingReplySent ${JSON.stringify({
        conversationId,
        tenantId,
      })}`,
    );
  }

  private async readLastHoldingSentAt(conversationId: string): Promise<string | null> {
    const { data, error } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    if (error || !data?.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) return null;
    const v = (data.metadata as Record<string, unknown>)[METADATA_LAST_HOLDING_SENT_AT];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  private async persistLastHoldingSentAt(conversationId: string): Promise<void> {
    const { data, error } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    if (error || !data) return;
    const prev =
      data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};
    const merged = {
      ...prev,
      [METADATA_LAST_HOLDING_SENT_AT]: new Date().toISOString(),
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
}
