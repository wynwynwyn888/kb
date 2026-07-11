// Pre-send safety: booking and unsupported-business-claim guards — runs before CRM outbound.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { classifyConversationIntent } from '../conversation-policy/conversation-intent';
import type { ReplyDecision } from '../reply-planning/dto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { KbService } from '../kb/kb.service';
import {
  isTrustedExecutedBookSlotSource,
  rewriteUnsupportedBusinessClaimsWhenNoKb,
  textClaimsBookingConfirmed,
} from '../../lib/outbound-safety-governor';

export interface OutboundGovernorContext {
  conversationId: string;
  tenantId: string;
  contactId: string;
}

@Injectable()
export class OutboundSafetyGovernorService {
  private readonly logger = new Logger(OutboundSafetyGovernorService.name);
  private readonly supabase = getSupabaseService();

  constructor(@Optional() private readonly kb?: KbService) {}

  /**
   * Allow confirmation wording only when a real booking intent already executed **before** we send
   * this outbound **and** the execution plausibly belongs to the current customer thread:
   * - Booking ran after the latest inbound timestamp (previous pipeline cycle completed), or
   * - Latest inbound is a short acknowledgment after a recent successful booking.
   */
  async hasEligibleBookingConfirmationLanguage(conversationId: string): Promise<boolean> {
    const inbound = await this.getLatestInbound(conversationId);
    if (!inbound?.created_at) return false;

    const { data, error } = await this.supabase
      .from('action_intents')
      .select('id, executed_at, params, source')
      .eq('conversation_id', conversationId)
      .eq('action_type', 'UPDATE_CALENDAR')
      .eq('status', 'EXECUTED')
      .contains('params', { bookSlotIntent: true })
      .order('executed_at', { ascending: false })
      .limit(5);

    if (error || !data?.length) {
      if (error) {
        this.logger.warn(`booking eligibility query: ${formatPostgrestError(error)}`);
      }
      return false;
    }

    const inboundMs = Date.parse(String(inbound.created_at));
    if (!Number.isFinite(inboundMs)) return false;

    const ackOnly = /^(thanks|thank\s+you|ok+|okay|great|perfect)\b[!?.\s]*$/i.test(inbound.content.trim());

    for (const row of data) {
      const src = row.source as string | null | undefined;
      if (!isTrustedExecutedBookSlotSource(src)) continue;
      const params = row.params as Record<string, unknown> | null | undefined;
      if (!params?.['calendarId'] || typeof params['calendarId'] !== 'string') continue;
      const execAtRaw = row.executed_at;
      if (!execAtRaw) continue;
      const em = Date.parse(String(execAtRaw));
      if (!Number.isFinite(em)) continue;

      if (em >= inboundMs - 3000) {
        return true;
      }
      if (ackOnly && em < inboundMs && inboundMs - em < 14 * 24 * 3600 * 1000) {
        return true;
      }
    }
    return false;
  }

  private async getLatestInbound(conversationId: string): Promise<{ content: string; created_at: string } | null> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('content, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return {
      content: String(data.content ?? ''),
      created_at: String(data.created_at ?? ''),
    };
  }

  async applyOutboundGovernor(plan: ReplyDecision, ctx: OutboundGovernorContext): Promise<ReplyDecision> {
    if (plan.planStatus !== 'PLANNED' || plan.bubbles.length === 0) {
      return plan;
    }

    let next = plan;

    next = await this.applyBookingClaimGuard(next, ctx.conversationId);
    next = await this.applyNoKbClaimGuard(next, ctx);

    return next;
  }

  private async applyNoKbClaimGuard(
    plan: ReplyDecision,
    ctx: OutboundGovernorContext,
  ): Promise<ReplyDecision> {
    const provenance = plan.draftProvenance ?? '';
    const rationale = plan.rationale ?? '';
    if (
      provenance === 'human_escalation' ||
      provenance === 'policy_reply' ||
      rationale.includes('follow_up')
    ) {
      return plan;
    }

    const inbound = await this.getLatestInbound(ctx.conversationId);
    let kbChunksReturned = 0;
    if (this.kb && inbound?.content?.trim()) {
      try {
        const kb = await this.kb.retrieve({
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId,
          query: inbound.content.trim(),
          topK: 4,
        });
        kbChunksReturned = kb.chunks?.length ?? 0;
      } catch (e) {
        this.logger.warn(
          `outboundNoKbGuardRetrieveFailed ${JSON.stringify({
            conversationId: ctx.conversationId,
            message: e instanceof Error ? e.message : String(e),
          })}`,
        );
      }
    }

    const joined = plan.bubbles.map(b => b.text).join('\n\n');
    const guarded = rewriteUnsupportedBusinessClaimsWhenNoKb({
      replyText: joined,
      kbChunksReturned,
      latestIntent: inbound?.content ? classifyConversationIntent(inbound.content) : 'UNKNOWN',
      latestUserMessage: inbound?.content,
    });
    if (!guarded.rewritten) return plan;

    this.logger.log(
      `outboundSafetyRewrite: ${JSON.stringify({
        reason: guarded.reason ?? 'unsupported_business_claim_no_kb',
        conversationId: ctx.conversationId,
      })}`,
    );

    return {
      ...plan,
      planStatus: 'HANDOVER',
      responseMode: 'handover',
      handoverRecommended: true,
      bubbles: [],
      rationale: `${plan.rationale}; humanTakeover=${guarded.reason ?? 'no_kb_claim'}`,
      suggestedActions: [
        ...plan.suggestedActions,
        {
          type: 'ESCALATE',
          params: { reason: guarded.reason ?? 'no_kb_claim' },
          reason: 'Outbound safety blocked unsupported no-KB claim',
        },
      ],
      draftProvenance: 'human_escalation',
    };
  }

  private async applyBookingClaimGuard(plan: ReplyDecision, conversationId: string): Promise<ReplyDecision> {
    const joined = plan.bubbles.map(b => b.text).join('\n\n');
    if (!textClaimsBookingConfirmed(joined)) {
      return plan;
    }

    const ok = await this.hasEligibleBookingConfirmationLanguage(conversationId);
    if (ok) {
      return plan;
    }

    this.logger.log(
      `outboundSafetyRewrite: ${JSON.stringify({
        reason: 'booking_confirmation_without_booking_action',
        conversationId,
      })}`,
    );

    return {
      ...plan,
      planStatus: 'HANDOVER',
      responseMode: 'handover',
      handoverRecommended: true,
      bubbles: [],
      rationale: `${plan.rationale}; humanTakeover=booking_confirmation_without_booking_action`,
      suggestedActions: [
        ...plan.suggestedActions,
        {
          type: 'ESCALATE',
          params: { reason: 'booking_confirmation_without_booking_action' },
          reason: 'Outbound safety blocked unverified booking confirmation',
        },
      ],
      draftProvenance: 'human_escalation',
    };
  }

}
