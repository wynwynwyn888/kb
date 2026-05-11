// Reply Planner Service — produces structured ReplyDecision from orchestration context.
// Uses live LLM generation when a provider is configured; falls back to deterministic drafting.
//
// FORMATTING OWNERSHIP (live outbound): `formatIntoBubbles` below is the canonical formatter
// for text shape on the real queue → GHL send path (orchestration enqueues `ReplyDecision`
// produced here). `FormatterService` (HTTP `/formatter`) is a separate optional/tooling path —
// not invoked during send-bubble execution. Do not assume parity; see drift note on FormatterService.
//
// Parity: `formatLiveCustomerDraftForPreview` mirrors this pipeline **and** the outbound
// coalescing step (`maybeCoalesceOutboundBubbles`) so Bot Test matches WhatsApp single-send
// spacing (see live-outbound-preview.ts).

import { Injectable, Logger } from '@nestjs/common';
import { stripCustomerFacingMeta, stripModelThinking } from '@aisbp/formatter';
import { packPlainTextIntoOutboundBubbles } from '../../lib/outbound-bubbles';
import { maybeCoalesceOutboundBubbles } from '../../lib/outbound-coalesce';
import {
  newlineDebugMetrics,
  prepareCustomerFacingPlainTextForOutboundSplit,
  previewWithVisibleNewlines,
  stripLiveCustomerMarkdownForOutbound,
} from '../../lib/customer-facing-live-format';
import { outboundWhitespaceDebugEnabled } from '../../lib/production-log-flags';
import {
  bulletizeAdjacentShortPhraseLines,
  tryReadabilityTwoBubbleDrafts,
} from '../../lib/whatsapp-readability-post';
import { polishKbSnippetForCustomer } from '../../lib/kb-faq-customer-text';
import { applyBusinessHoursGroundingGuard } from '../../lib/business-hours-grounding-guard';
import { applyMenuKbGroundingGuard } from '../../lib/menu-kb-grounding-guard';
import { sanitizeOutboundInternalKbLeak } from '../../lib/outbound-internal-kb-sanitizer';
import { applyOutboundPolicyGuard } from '../../lib/outbound-policy-guard';
import { detectMenuIntentInMessage } from '../../lib/kb-relevance';
import { rewriteUnsupportedBusinessClaimsWhenNoKb } from '../../lib/outbound-safety-governor';
import { stripProactiveHandoverCtaIfNeeded } from '../../lib/proactive-handover-cta-guard';
import { safeTextPreviewForLog } from '../../lib/safe-text-preview-for-log';
import { isProductionEnv } from '../../lib/safe-text-preview-for-log';
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
  /** Debounced batch: blank-line joined lines for one model user turn (live only). */
  combinedHumanMessagesText?: string;
  inboundBatchCount?: number;
  batchPrimaryIntent?: ConversationIntent;
  batchSecondaryIntents?: ConversationIntent[];
  repeatedHumanTextDetected?: boolean;
  repeatedHumanTextAction?: 'none' | 'answer_again' | 'concise_confirm';
  /** Hair-salon: prior colour topic must not drive recommendations for out-of-scope questions. */
  suppressColourRecommendations?: boolean;
  bookingCapability?: 'collect_details_only' | 'live_slot_booking' | string;
  handoverCapability?: string;
  /** Prior assistant menu excerpt for deterministic letter picks (no KB). */
  optionMenuSourceExcerpt?: string;
  /** Business notes + tenant prompt body — ground-truth for explicit pricing when KB is empty. */
  tenantPricingCorpus?: string;
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
  /**
   * Pure option-letter reply: no LLM, no menu grounding rewrite (we already trust the option line).
   */
  buildOptionSelectionTemplateReply(params: {
    tenantId: string;
    conversationId: string;
    routing: RoutingResponse;
    templateBody: string;
    latestIntent: ConversationIntent;
    latestUserMessage: string;
    menuSelectionActive: boolean;
  }): ReplyDecision {
    const {
      tenantId,
      conversationId,
      routing,
      templateBody,
      latestIntent,
      latestUserMessage,
      menuSelectionActive,
    } = params;

    const guarded = applyOutboundPolicyGuard({
      latestIntent,
      menuSelectionActive,
      draftText: templateBody,
    });
    const afterHours = applyBusinessHoursGroundingGuard({
      latestIntent,
      userMessage: latestUserMessage,
      kbChunks: [],
      draftText: guarded,
    });
    const afterKbLeak = sanitizeOutboundInternalKbLeak(afterHours, latestIntent, []);
    const proactive = stripProactiveHandoverCtaIfNeeded({
      replyText: afterKbLeak,
      latestIntent,
      latestUserMessage,
    });
    if (proactive.removed) {
      this.logger.log(
        `proactiveHandoverCtaRemoved ${JSON.stringify({
          tenantId,
          conversationId,
          latestIntent,
          reason: proactive.reason ?? 'proactive_handover_cta',
        })}`,
      );
    }
    const bubbles = this.formatIntoBubbles(proactive.text);
    this.logLiveWhitespaceDebug({
      rawDraft: proactive.text,
      bubbles,
      latestUserMessage,
      inboundBatchCount: 1,
    });

    return {
      planStatus: 'PLANNED',
      responseMode: routing.responseMode,
      handoverRecommended: routing.handoverRecommended,
      confidence: routing.confidence,
      rationale: routing.reasoning,
      bubbles,
      suggestedActions: this.suggestActions(routing, []),
      draftProvenance: 'option_selection_template',
      routingRecommendedModel: routing.recommendedModel,
    };
  }

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
      const afterKbLeak = sanitizeOutboundInternalKbLeak(afterHours, policyContext!.latestIntent, kbChunks);
      const proactiveForced = stripProactiveHandoverCtaIfNeeded({
        replyText: afterKbLeak,
        latestIntent: policyContext!.latestIntent,
        latestUserMessage: policyContext?.latestUserMessage,
        combinedHumanMessagesText: policyContext?.combinedHumanMessagesText,
      });
      if (proactiveForced.removed) {
        this.logger.log(
          `proactiveHandoverCtaRemoved ${JSON.stringify({
            tenantId,
            conversationId,
            latestIntent: policyContext!.latestIntent,
            reason: proactiveForced.reason ?? 'proactive_handover_cta',
          })}`,
        );
      }
      const bubbles = this.formatIntoBubbles(proactiveForced.text);
      this.logLiveWhitespaceDebug({
        rawDraft: proactiveForced.text,
        bubbles,
        latestUserMessage: policyContext?.latestUserMessage,
        combinedHumanMessagesText: policyContext?.combinedHumanMessagesText,
        inboundBatchCount: policyContext?.inboundBatchCount,
      });
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
      kbChunks,
    );
    const noKbClaimGuard = rewriteUnsupportedBusinessClaimsWhenNoKb({
      replyText: afterKbLeak,
      kbChunksReturned: kbChunks.length,
      latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
      latestUserMessage: policyContext?.latestUserMessage ?? '',
      tenantId,
      conversationId,
      tenantPricingCorpus: policyContext?.tenantPricingCorpus ?? '',
    });
    const finalDraft = noKbClaimGuard.rewritten ? noKbClaimGuard.text : afterKbLeak;
    if (noKbClaimGuard.supportCheckLog) {
      this.logger.log(`unsupportedClaimSupportCheck ${JSON.stringify(noKbClaimGuard.supportCheckLog)}`);
    }
    if (noKbClaimGuard.rewritten && noKbClaimGuard.log) {
      this.logger.log(
        `unsupportedClaimRewriteApplied ${JSON.stringify({
          ...noKbClaimGuard.log,
          originalReason: noKbClaimGuard.reason,
        })}`,
      );
    }
    const proactiveLive = stripProactiveHandoverCtaIfNeeded({
      replyText: finalDraft,
      latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
      latestUserMessage: policyContext?.latestUserMessage,
      combinedHumanMessagesText: policyContext?.combinedHumanMessagesText,
    });
    if (proactiveLive.removed) {
      this.logger.log(
        `proactiveHandoverCtaRemoved ${JSON.stringify({
          tenantId,
          conversationId,
          latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
          reason: proactiveLive.reason ?? 'proactive_handover_cta',
        })}`,
      );
    }
    const bubbles = this.formatIntoBubbles(proactiveLive.text);
    this.logLiveWhitespaceDebug({
      rawDraft: proactiveLive.text,
      bubbles,
      latestUserMessage: policyContext?.latestUserMessage,
      combinedHumanMessagesText: policyContext?.combinedHumanMessagesText,
      inboundBatchCount: policyContext?.inboundBatchCount,
    });

    // ---------- Suggest actions ----------
    const suggestedActions = this.suggestActions(routing, kbChunks);

    const decision: ReplyDecision = {
      planStatus: 'PLANNED',
      responseMode: routing.responseMode,
      handoverRecommended: routing.handoverRecommended,
      confidence: routing.confidence,
      rationale: noKbClaimGuard.rewritten
        ? `${routing.reasoning}; outboundSafetyRewrite=${noKbClaimGuard.reason}`
        : routing.reasoning,
      bubbles,
      suggestedActions,
      draftProvenance: draft.provenance,
      ...(draft.provenance === 'placeholder_fallback' && draft.fallbackReason
        ? { draftFallbackReason: draft.fallbackReason }
        : {}),
      ...(draft.agencyActiveProvider ? { agencyActiveProvider: draft.agencyActiveProvider } : {}),
      ...(draft.configuredModel ? { configuredModel: draft.configuredModel } : {}),
      ...(draft.routingRecommendedModel ? { routingRecommendedModel: draft.routingRecommendedModel } : {}),
      ...(draft.generationProvider ? { generationProvider: draft.generationProvider } : {}),
      ...(draft.generationModel ? { generationModel: draft.generationModel } : {}),
      ...(draft.generationModelActuallyUsed
        ? { generationModelActuallyUsed: draft.generationModelActuallyUsed }
        : {}),
      ...(draft.usedOpenAiFallback ? { usedOpenAiFallback: draft.usedOpenAiFallback } : {}),
      ...(draft.fallbackUsed != null ? { fallbackUsed: draft.fallbackUsed } : {}),
    };

    const genMeta =
      draft.generationProvider && draft.generationModel
        ? `, agencyActiveProvider=${draft.agencyActiveProvider ?? 'n/a'}, configuredModel=${draft.configuredModel ?? 'n/a'}, ` +
          `routingRecommendedModel=${draft.routingRecommendedModel ?? routing.recommendedModel}, ` +
          `generationProvider=${draft.generationProvider}, generationModelActuallyUsed=${draft.generationModelActuallyUsed ?? draft.generationModel}` +
          (draft.usedOpenAiFallback ? ', fallbackUsed=true' : '')
        : '';
    this.logger.log(
      `Reply planning completed: conversation=${conversationId}, ` +
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
    configuredModel?: string;
    routingRecommendedModel?: string;
    generationProvider?: 'MINIMAX' | 'OPENAI';
    generationModel?: string;
    generationModelActuallyUsed?: string;
    usedOpenAiFallback?: boolean;
    fallbackUsed?: boolean;
  }> {
    const lastUser = [...memory].reverse().find(m => m.role === 'user');
    const lastLine = lastUser?.content?.trim() ?? '';
    const combined = policyContext?.combinedHumanMessagesText?.trim();
    const batchCount = policyContext?.inboundBatchCount ?? 0;
    let incomingForGen = combined && combined.length > 0 ? combined : lastLine;
    if (batchCount > 1 && (!incomingForGen || incomingForGen === lastLine)) {
      const users = [...memory].reverse().filter(m => m.role === 'user').slice(0, batchCount).reverse();
      const stitched = users.map(u => (u.content ?? '').trim()).filter(Boolean).join('\n\n');
      if (stitched.length > 0) incomingForGen = stitched;
    }

    const handling: 'none' | 'concise_repeat' | 'confirm_echo' =
      policyContext?.repeatedHumanTextAction === 'concise_confirm'
        ? 'confirm_echo'
        : policyContext?.repeatedHumanTextAction === 'answer_again'
          ? 'concise_repeat'
          : 'none';

    const generationStarted = Date.now();
    const liveDraft = await this.generationService.generateDraft({
      tenantId,
      incomingMessage: incomingForGen,
      systemPrompt,
      memory,
      kbContext: kbChunks,
      routingRecommendedModel: routing.recommendedModel ?? '',
      ...(batchCount > 1 ? { inboundBatchUserLineCount: batchCount } : {}),
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
              ...(batchCount > 1 ? { combinedInboundMessageCount: batchCount } : {}),
              ...(handling !== 'none' ? { repeatedCustomerMessageHandling: handling } : {}),
              ...(policyContext.suppressColourRecommendations === true
                ? { suppressColourRecommendations: true }
                : {}),
              ...(policyContext.bookingCapability
                ? { bookingCapability: policyContext.bookingCapability }
                : {}),
              ...(policyContext.handoverCapability
                ? { handoverCapability: policyContext.handoverCapability }
                : {}),
              ...(policyContext.optionMenuSourceExcerpt?.trim()
                ? { optionMenuSourceExcerpt: policyContext.optionMenuSourceExcerpt.trim() }
                : {}),
            },
          }
        : {}),
    });
    const generation_ms = Date.now() - generationStarted;

    const trimmed = stripModelThinking(liveDraft.content ?? '').trim();
    if (trimmed.length > 0) {
      const gma = liveDraft.generationModelActuallyUsed ?? liveDraft.generationModel;
      this.logger.log(
        `Live draft generated: generation_ms=${generation_ms} ${trimmed.length} chars (generationModelActuallyUsed=${gma ?? 'n/a'}, configuredModel=${liveDraft.configuredModel ?? 'n/a'})`,
      );
      return {
        text: trimmed,
        provenance: 'live_generation',
        agencyActiveProvider: liveDraft.agencyActiveProvider,
        configuredModel: liveDraft.configuredModel,
        routingRecommendedModel: liveDraft.routingRecommendedModel ?? routing.recommendedModel,
        generationProvider: liveDraft.generationProvider,
        generationModel: liveDraft.generationModel,
        generationModelActuallyUsed: gma,
        usedOpenAiFallback: liveDraft.usedOpenAiFallback,
        fallbackUsed: liveDraft.fallbackUsed ?? Boolean(liveDraft.usedOpenAiFallback),
      };
    }

    this.logger.log(
      `generationTiming: placeholder_path generation_ms=${generation_ms} configuredModel=${liveDraft.configuredModel ?? 'n/a'} skipReason=${liveDraft.skipReason ?? 'n/a'}`,
    );

    const fallbackReason =
      liveDraft.skipReason ??
      (liveDraft.content !== null && trimmed.length === 0 ? 'generation_failed' : undefined);

    const text = this.buildPlaceholderDraft(routing, kbChunks, memory);
    return {
      text,
      provenance: 'placeholder_fallback',
      fallbackReason,
      agencyActiveProvider: liveDraft.agencyActiveProvider,
      configuredModel: liveDraft.configuredModel,
      routingRecommendedModel: liveDraft.routingRecommendedModel ?? routing.recommendedModel,
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
      // Generic, business-agnostic — never invent categories.
      return 'Happy to help — what would you like to know about our offerings?';
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
   * - `stripLiveCustomerMarkdownForOutbound` (regex-based; preserves paragraph breaks)
   * - `prepareCustomerFacingPlainTextForOutboundSplit` then `packPlainTextIntoOutboundBubbles`
   * Not the same as `FormatterService` / `@aisbp/formatter` (see FormatterService drift doc).
   */
  private formatIntoBubbles(text: string): ReplyBubbleDraft[] {
    const stripped = stripLiveCustomerMarkdownForOutbound(
      stripCustomerFacingMeta(stripModelThinking(text)),
    );
    const prepared = prepareCustomerFacingPlainTextForOutboundSplit(stripped);
    const bulletized = bulletizeAdjacentShortPhraseLines(prepared);
    const readabilityTwo = tryReadabilityTwoBubbleDrafts(bulletized);
    if (readabilityTwo) return readabilityTwo;
    return packPlainTextIntoOutboundBubbles(bulletized);
  }

  private logLiveWhitespaceDebug(opts: {
    rawDraft: string;
    bubbles: ReplyBubbleDraft[];
    latestUserMessage?: string;
    combinedHumanMessagesText?: string;
    inboundBatchCount?: number;
  }): void {
    const rawM = newlineDebugMetrics(opts.rawDraft);
    const joined = opts.bubbles.map(b => b.text).join('\n\n');
    const planM = newlineDebugMetrics(joined);
    const physical = maybeCoalesceOutboundBubbles(opts.bubbles.map(b => ({ index: b.index, text: b.text })));
    const phyJoined = physical.map(b => b.text).join('\n\n');
    const phyM = newlineDebugMetrics(phyJoined);
    const probeText = `${opts.combinedHumanMessagesText ?? ''}\n${opts.latestUserMessage ?? ''}`;
    const menuish = /\bmenu\b/i.test(probeText);
    const preview = previewWithVisibleNewlines(phyJoined, 420);
    const safePreview = safeTextPreviewForLog(phyJoined, { hashSalt: 'finalOutboundPreview' });
    const previewClause = isProductionEnv()
      ? ''
      : ` finalOutboundWhitespacePreview=${JSON.stringify(preview)}`;
    const line =
      `liveOutboundWhitespace: rawDraftNewlines=${rawM.newlineCount} rawDraftDoubleNl=${rawM.doubleNewlineSeqCount} ` +
      `plannedBubbleNewlines=${planM.newlineCount} plannedBubbleDoubleNl=${planM.doubleNewlineSeqCount} ` +
      `plannedPhysicalOutboundNewlines=${phyM.newlineCount} plannedPhysicalOutboundDoubleNl=${phyM.doubleNewlineSeqCount} ` +
      `logicalBubbleCount=${opts.bubbles.length} physicalOutboundPlanCount=${physical.length} inboundBatchCount=${opts.inboundBatchCount ?? 1} ` +
      `menuishProbe=${menuish} ` +
      `finalOutboundPreview=${JSON.stringify(safePreview)}` +
      previewClause;
    const forceLog =
      menuish ||
      opts.bubbles.length > 1 ||
      physical.length < opts.bubbles.length ||
      (opts.inboundBatchCount ?? 0) > 1;
    if (outboundWhitespaceDebugEnabled() && forceLog) {
      this.logger.log(line);
    } else {
      this.logger.debug(line);
    }
  }

  private suggestActions(
    routing: RoutingResponse,
    kbChunks: RetrievalChunk[],
  ): SuggestedAction[] {
    // Suggested actions: TAG_CONTACT only. BOOK_SLOT is not emitted here — live booking is owned by
    // ConversationBookingFlowService (sync GHL create + EXECUTED intent). Deferred BOOK_SLOT execution
    // is disabled by default in ActionIntentExecutorService.
    const actions: SuggestedAction[] = [];

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
