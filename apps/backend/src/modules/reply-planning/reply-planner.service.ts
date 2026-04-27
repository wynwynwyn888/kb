// Reply Planner Service — produces structured ReplyDecision from orchestration context.
// Uses live LLM generation when a provider is configured; falls back to deterministic drafting.
//
// FORMATTING OWNERSHIP (live outbound): `formatIntoBubbles` below is the canonical formatter
// for text shape on the real queue → GHL send path (orchestration enqueues `ReplyDecision`
// produced here). `FormatterService` (HTTP `/formatter`) is a separate optional/tooling path —
// not invoked during send-bubble execution. Do not assume parity; see drift note on FormatterService.

import { Injectable, Logger } from '@nestjs/common';
import { stripCustomerFacingMeta, stripModelThinking } from '@aisbp/formatter';
import { packPlainTextIntoOutboundBubbles } from '../../lib/outbound-bubbles';
import { polishKbSnippetForCustomer } from '../../lib/kb-faq-customer-text';
import { applyBusinessHoursGroundingGuard } from '../../lib/business-hours-grounding-guard';
import { applyMenuKbGroundingGuard } from '../../lib/menu-kb-grounding-guard';
import { sanitizeOutboundInternalKbLeak } from '../../lib/outbound-internal-kb-sanitizer';
import { applyOutboundPolicyGuard } from '../../lib/outbound-policy-guard';
import { detectMenuIntentInMessage } from '../../lib/kb-relevance';
import type { ConversationIntent } from '../conversation-policy/conversation-intent';
import type { SelectionResolution } from '../conversation-policy/option-resolver';
import { GenerationService } from '../generation/generation.service';
import type {
  ReplyDecision,
  ReplyPlanStatus,
  ReplyBubbleDraft,
  SuggestedAction,
} from './dto';
import type { RoutingResponse } from '../orchestration/dto';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import type { MemoryEntry } from '../orchestration/dto';

export interface ReplyPlanPolicyContext {
  latestIntent: ConversationIntent;
  resolvedSelection: SelectionResolution | null;
  conversationStateSummary: string;
  policyForcedReply: string | null;
  policyReplyKind: string;
  menuSelectionActive: boolean;
  /** Latest inbound customer text (for hours/meal grounding). */
  latestUserMessage?: string;
}

@Injectable()
export class ReplyPlannerService {
  private readonly logger = new Logger(ReplyPlannerService.name);

  constructor(private readonly generationService: GenerationService) {}

  /**
   * Build a ReplyDecision from orchestration context.
   *
   * Strategy:
   * - If handover → HANDOVER plan, no bubbles
   * - Otherwise attempt live generation via GenerationService
   * - Fall back to deterministic drafting if generation is unavailable or fails
   */
  async planReply(params: {
    tenantId: string;
    routing: RoutingResponse;
    kbChunks: RetrievalChunk[];
    memory: MemoryEntry[];
    systemPrompt: string;
    conversationId: string;
    channel: string;
    /** From subaccount `tenant_prompt_configs` when set. */
    temperature?: number;
    maxTokens?: number | null;
    policyContext?: ReplyPlanPolicyContext;
  }): Promise<ReplyDecision> {
    const { tenantId, routing, kbChunks, memory, systemPrompt, conversationId, policyContext } = params;

    this.logger.debug(
      `Reply planning started: conversation=${conversationId}, mode=${routing.responseMode}`,
    );

    // ---------- Handover cases ----------
    if (routing.handoverRecommended || routing.responseMode === 'handover') {
      const plan = this.buildHandoverPlan(routing);
      this.logger.log(
        `Reply planning: handover recommended for conversation=${conversationId}`,
      );
      return plan;
    }

    // ---------- Conversation policy forced reply (no LLM) ----------
    const forced = policyContext?.policyForcedReply?.trim();
    if (forced) {
      this.logger.log(`Policy reply chosen: ${policyContext!.policyReplyKind}`);
      const guarded = applyOutboundPolicyGuard({
        latestIntent: policyContext!.latestIntent,
        menuSelectionActive: policyContext!.menuSelectionActive,
        draftText: forced,
      });
      const afterMenu = applyMenuKbGroundingGuard({
        latestIntent: policyContext!.latestIntent,
        menuSelectionActive: policyContext!.menuSelectionActive,
        draftText: guarded,
        kbChunks,
        categoryLabel: policyContext!.resolvedSelection?.selectedText ?? null,
      });
      const afterHours = applyBusinessHoursGroundingGuard({
        latestIntent: policyContext!.latestIntent,
        userMessage: policyContext?.latestUserMessage ?? '',
        kbChunks,
        draftText: afterMenu,
      });
      const afterKbLeak = sanitizeOutboundInternalKbLeak(afterHours, policyContext!.latestIntent);
      const bubbles = this.formatIntoBubbles(afterKbLeak);
      const suggestedActions = this.suggestActions(routing, kbChunks);
      return {
        planStatus: 'PLANNED',
        responseMode: routing.responseMode,
        handoverRecommended: routing.handoverRecommended,
        confidence: routing.confidence,
        rationale: routing.reasoning,
        bubbles,
        suggestedActions,
        draftProvenance: 'policy_reply',
      };
    }

    // ---------- Live generation or fallback ----------
    const draft = await this.buildDraft(
      tenantId,
      routing,
      kbChunks,
      memory,
      systemPrompt,
      params.temperature,
      params.maxTokens,
      policyContext,
    );

    // ---------- Format into bubbles ----------
    const guardedDraft = applyOutboundPolicyGuard({
      latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
      menuSelectionActive: policyContext?.menuSelectionActive ?? false,
      draftText: draft.text,
    });
    const afterMenu = applyMenuKbGroundingGuard({
      latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
      menuSelectionActive: policyContext?.menuSelectionActive ?? false,
      draftText: guardedDraft,
      kbChunks,
      categoryLabel: policyContext?.resolvedSelection?.selectedText ?? null,
    });
    const afterHours = applyBusinessHoursGroundingGuard({
      latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
      userMessage: policyContext?.latestUserMessage ?? '',
      kbChunks,
      draftText: afterMenu,
    });
    const afterKbLeak = sanitizeOutboundInternalKbLeak(
      afterHours,
      policyContext?.latestIntent ?? 'UNKNOWN',
    );
    const bubbles = this.formatIntoBubbles(afterKbLeak);

    // ---------- Suggest actions ----------
    const suggestedActions = this.suggestActions(routing, kbChunks);

    const decision: ReplyDecision = {
      planStatus: 'PLANNED',
      responseMode: routing.responseMode,
      handoverRecommended: routing.handoverRecommended,
      confidence: routing.confidence,
      rationale: routing.reasoning,
      bubbles,
      suggestedActions,
      draftProvenance: draft.provenance,
      ...(draft.provenance === 'placeholder_fallback' && draft.fallbackReason
        ? { draftFallbackReason: draft.fallbackReason }
        : {}),
      ...(draft.agencyActiveProvider ? { agencyActiveProvider: draft.agencyActiveProvider } : {}),
      ...(draft.generationProvider ? { generationProvider: draft.generationProvider } : {}),
      ...(draft.generationModel ? { generationModel: draft.generationModel } : {}),
      ...(draft.usedOpenAiFallback ? { usedOpenAiFallback: draft.usedOpenAiFallback } : {}),
    };

    const genMeta =
      draft.generationProvider && draft.generationModel
        ? `, agencyActiveProvider=${draft.agencyActiveProvider ?? 'n/a'}, generationProvider=${draft.generationProvider}, generationModel=${draft.generationModel}` +
          (draft.usedOpenAiFallback ? ', usedOpenAiFallback=true' : '')
        : '';
    this.logger.log(
      `Reply planning completed: conversation=${conversationId}, routingRecommendedModel=${routing.recommendedModel}, ` +
        `bubbles=${bubbles.length}, mode=${routing.responseMode}, draftProvenance=${draft.provenance}` +
        genMeta +
        (draft.fallbackReason ? `, draftFallbackReason=${draft.fallbackReason}` : ''),
    );

    return decision;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildHandoverPlan(routing: RoutingResponse): ReplyDecision {
    return {
      planStatus: 'HANDOVER',
      responseMode: routing.responseMode,
      handoverRecommended: true,
      confidence: routing.confidence,
      rationale: 'handoverRecommended=true from routing; no reply drafted',
      bubbles: [],
      suggestedActions: [
        {
          type: 'ESCALATE',
          params: { reason: 'handover_recommended' },
          reason: 'AI routing determined human handoff is needed',
        },
      ],
    };
  }

  /**
   * Build a draft: try live generation first, fall back to deterministic placeholder.
   */
  private async buildDraft(
    tenantId: string,
    routing: RoutingResponse,
    kbChunks: RetrievalChunk[],
    memory: MemoryEntry[],
    systemPrompt: string,
    subaccountTemperature?: number,
    subaccountMaxTokens?: number | null,
    policyContext?: ReplyPlanPolicyContext,
  ): Promise<{
    text: string;
    provenance: 'live_generation' | 'placeholder_fallback' | 'policy_reply';
    fallbackReason?: 'no_agency' | 'no_provider' | 'generation_failed';
    agencyActiveProvider?: string;
    generationProvider?: 'MINIMAX' | 'OPENAI';
    generationModel?: string;
    usedOpenAiFallback?: boolean;
  }> {
    const lastUser = [...memory].reverse().find(m => m.role === 'user');
    const incomingMessage = lastUser?.content?.trim() ?? '';

    const liveDraft = await this.generationService.generateDraft({
      tenantId,
      incomingMessage,
      systemPrompt,
      memory,
      kbContext: kbChunks,
      model: routing.recommendedModel,
      ...(subaccountTemperature != null && Number.isFinite(subaccountTemperature)
        ? { temperature: subaccountTemperature }
        : {}),
      ...(subaccountMaxTokens != null && subaccountMaxTokens > 0
        ? { maxTokens: subaccountMaxTokens }
        : {}),
      ...(policyContext
        ? {
            policyContext: {
              latestIntent: policyContext.latestIntent,
              resolvedSelection: policyContext.resolvedSelection,
              conversationStateSummary: policyContext.conversationStateSummary,
              menuSelectionActive: policyContext.menuSelectionActive,
            },
          }
        : {}),
    });

    const trimmed = stripModelThinking(liveDraft.content ?? '').trim();
    if (trimmed.length > 0) {
      this.logger.log(
        `Live draft generated: ${trimmed.length} chars (generationModel=${liveDraft.generationModel ?? 'n/a'})`,
      );
      return {
        text: trimmed,
        provenance: 'live_generation',
        agencyActiveProvider: liveDraft.agencyActiveProvider,
        generationProvider: liveDraft.generationProvider,
        generationModel: liveDraft.generationModel,
        usedOpenAiFallback: liveDraft.usedOpenAiFallback,
      };
    }

    const fallbackReason =
      liveDraft.skipReason ??
      (liveDraft.content !== null && trimmed.length === 0 ? 'generation_failed' : undefined);

    const text = this.buildPlaceholderDraft(routing, kbChunks, memory);
    return {
      text,
      provenance: 'placeholder_fallback',
      fallbackReason,
      agencyActiveProvider: liveDraft.agencyActiveProvider,
    };
  }

  /**
   * Deterministic fallback: KB-first, then mode-based ack, then memory, then generic.
   */
  private buildPlaceholderDraft(
    routing: RoutingResponse,
    kbChunks: RetrievalChunk[],
    memory: MemoryEntry[],
  ): string {
    // Build from KB context
    if (kbChunks.length > 0) {
      const top = kbChunks[0]!;
      const curated = top.metadata?.['menuCurated'] === true;
      const limit = curated ? 900 : 480;
      const snippet = top.content.slice(0, limit).trim();
      const ellipsed =
        `${snippet}${snippet.length === top.content.length ? '' : '...'}`;
      return polishKbSnippetForCustomer(ellipsed);
    }

    // Fallback: short acknowledgment based on response mode
    if (routing.responseMode === 'fast') {
      return 'Got it! Let me look into that for you.';
    }

    const lastUserMessage = memory.filter(m => m.role === 'user').at(-1);
    const lastMsg = lastUserMessage?.content?.trim() ?? '';

    if (detectMenuIntentInMessage(lastMsg)) {
      return 'I can help with the menu. Are you looking for starters, mains, desserts, drinks, or vegan options?';
    }

    if (lastMsg.length > 0) {
      return "I can help with that, but I don't have those details here yet. Could you tell me what you'd like to know specifically?";
    }

    return 'Thanks for reaching out. How can I help?';
  }

  /**
   * Canonical outbound bubble shaping for live sends: this is what enqueue → GHL uses.
   * Rules:
   * - `stripModelThinking` + `stripCustomerFacingMeta` (no citation/debug lines to customers)
   * - Local `stripMarkdown` (regex-based)
   * - `packPlainTextIntoOutboundBubbles`: ≤500 chars → one bubble; longer → pack sections
   *   up to ~520 chars each, at most 3 bubbles (sentence split only when needed)
   * Not the same as `FormatterService` / `@aisbp/formatter` (see FormatterService drift doc).
   */
  private formatIntoBubbles(text: string): ReplyBubbleDraft[] {
    const stripped = this.stripMarkdown(
      stripCustomerFacingMeta(stripModelThinking(text)),
    );
    return packPlainTextIntoOutboundBubbles(stripped);
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
      .replace(/\*(.+?)\*/g, '$1')       // italic
      .replace(/__(.+?)__/g, '$1')       // underline
      .replace(/~~(.+?)~~/g, '$1')       // strikethrough
      .replace(/#{1,6}\s+(.+)/g, '$1')  // headings
      .replace(/`(.+?)`/g, '$1')         // inline code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
      .replace(/^\s*[-*+]\s+/gm, '')      // list bullets
      .replace(/^\s*\d+\.\s+/gm, '')     // ordered list numbers
      .replace(/\n{3,}/g, '\n\n')        // collapse multiple blank lines
      .trim();
  }

  private suggestActions(
    routing: RoutingResponse,
    kbChunks: RetrievalChunk[],
  ): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    if (routing.bookingIntentDetected) {
      actions.push({
        type: 'BOOK_SLOT',
        params: { detected: true },
        reason: 'bookingIntentDetected=true from routing',
      });
    }

    if (routing.tagsSuggested.length > 0) {
      actions.push({
        type: 'TAG_CONTACT',
        params: { tags: routing.tagsSuggested },
        reason: `routing suggested tags: [${routing.tagsSuggested.join(', ')}]`,
      });
    }

    return actions;
  }
}
