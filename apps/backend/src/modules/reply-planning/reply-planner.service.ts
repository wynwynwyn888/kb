// Reply Planner Service — produces structured ReplyDecision from orchestration context.
// Uses live LLM generation when a provider is configured.
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
import { applyBusinessHoursGroundingGuard } from '../../lib/business-hours-grounding-guard';
import { applyMenuKbGroundingGuard } from '../../lib/menu-kb-grounding-guard';
import { sanitizeOutboundInternalKbLeak } from '../../lib/outbound-internal-kb-sanitizer';

import { applyOutboundPolicyGuard } from '../../lib/outbound-policy-guard';
import { rewriteUnsupportedBusinessClaimsWhenNoKb } from '../../lib/outbound-safety-governor';
import { stripProactiveHandoverCtaIfNeeded } from '../../lib/proactive-handover-cta-guard';
import { containsBotHumanEscalationLanguage } from '../../lib/bot-human-escalation-language';
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
  bookingCapability?: 'collect_details_only' | 'live_slot_booking' | string;
  handoverCapability?: string;
  /** Assistant replies already visible before this turn. Used to avoid restarting first-message flows. */
  priorAssistantMessageCount?: number;
  /** Recent assistant history already contains a booking/scheduling URL. */
  recentAssistantBookingUrlSent?: boolean;
  /** Prior assistant menu excerpt for deterministic letter picks (no KB). */
  optionMenuSourceExcerpt?: string;
  /** Multiple choices received inside one trailing-debounce burst. */
  multiOptionSelections?: Array<{ label: string; text: string }>;
  /** Business notes + tenant prompt body — ground-truth for explicit pricing when KB is empty. */
  tenantPricingCorpus?: string;
}

const CONVERSATIONAL_HESITATION = /^(?:h+m+|huh+|erm+|umm+|uh+|not sure|maybe|idk|🤔)[.!?…\s]*$/i;

function isConversationalHesitation(text: string, intent: ConversationIntent): boolean {
  return intent === 'HESITATION' ||
    (intent === 'UNKNOWN' && CONVERSATIONAL_HESITATION.test(text.trim()));
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
   * - If generation cannot produce a safe customer reply, skip instead of sending canned copy
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
    const proactive = this.prepareProactiveHandoverOutboundText({
      replyText: afterKbLeak,
      latestIntent,
      latestUserMessage,
      tenantId,
      conversationId,
    });
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
      ...(proactive.botHumanEscalationLanguageDetected
        ? { botHumanEscalationLanguageDetected: true }
        : {}),
    };
  }

  /** Mandatory tenant-configured playbook turn: trusted configured copy, no LLM variation. */
  buildMandatoryPlaybookTemplateReply(params: {
    tenantId: string;
    conversationId: string;
    routing: RoutingResponse;
    templateBody: string;
    latestIntent: ConversationIntent;
    latestUserMessage: string;
  }): ReplyDecision {
    const { tenantId, conversationId, routing, templateBody, latestIntent, latestUserMessage } = params;
    const guarded = applyOutboundPolicyGuard({
      latestIntent,
      menuSelectionActive: false,
      draftText: templateBody,
    });
    const afterHours = applyBusinessHoursGroundingGuard({
      latestIntent,
      userMessage: latestUserMessage,
      kbChunks: [],
      draftText: guarded,
    });
    const afterKbLeak = sanitizeOutboundInternalKbLeak(afterHours, latestIntent, []);
    const proactive = this.prepareProactiveHandoverOutboundText({
      replyText: afterKbLeak,
      latestIntent,
      latestUserMessage,
      tenantId,
      conversationId,
    });
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
      draftProvenance: 'mandatory_playbook_template',
      routingRecommendedModel: routing.recommendedModel,
      ...(proactive.botHumanEscalationLanguageDetected
        ? { botHumanEscalationLanguageDetected: true }
        : {}),
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
    /** Latest inbound customer photo URL for vision generation. */
    incomingImageUrl?: string | null;
    /** Tenant display name for brand identity outbound guard. */
    businessDisplayName?: string;
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
      if (!afterKbLeak.trim()) {
        return this.buildSkipNoReplyPlan({
          routing,
          rationale: `policy_reply_blocked:${policyContext!.policyReplyKind}`,
        });
      }
      const proactiveForced = this.prepareProactiveHandoverOutboundText({
        replyText: afterKbLeak,
        latestIntent: policyContext!.latestIntent,
        latestUserMessage: policyContext?.latestUserMessage,
        combinedHumanMessagesText: policyContext?.combinedHumanMessagesText,
        tenantId,
        conversationId,
      });
      if (!proactiveForced.text.trim()) {
        return this.buildSkipNoReplyPlan({
          routing,
          rationale: `policy_reply_blocked_after_cta_strip:${policyContext!.policyReplyKind}`,
        });
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
        ...(proactiveForced.botHumanEscalationLanguageDetected
          ? { botHumanEscalationLanguageDetected: true }
          : {}),
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
      params.incomingImageUrl,
      params.businessDisplayName,
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
      tenantConfiguredSelection: (policyContext?.multiOptionSelections?.length ?? 0) > 1,
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
    let finalDraft = noKbClaimGuard.rewritten ? noKbClaimGuard.text : afterKbLeak;

    // A low-information conversational cue such as "hmmm" is not a request for an
    // unknown business fact. If the first model draft mixes a useful next-step question
    // with an unsupported claim, retry once with tighter constraints instead of replacing
    // the whole turn with the human-escalation holding message.
    if (
      !finalDraft.trim() &&
      noKbClaimGuard.rewritten &&
      noKbClaimGuard.reason === 'no_kb_unsupported_business_claim' &&
      isConversationalHesitation(
        policyContext?.latestUserMessage ?? '',
        policyContext?.latestIntent ?? 'UNKNOWN',
      )
    ) {
      const retryDraft = await this.buildDraft(
        tenantId,
        routing,
        kbChunks,
        memory,
        `${systemPrompt}\n\nRETRY SAFETY INSTRUCTION (this turn only): The customer is expressing hesitation, not asking for a business fact. Reply naturally using the conversation so far. Briefly acknowledge the hesitation and guide them with exactly one easy next-step question. Do not introduce or assert any new price, policy, availability, opening hours, booking confirmation, product, service, or business capability. Do not mention knowledge-base limitations or human escalation.`,
        params.temperature,
        params.maxTokens,
        policyContext,
        params.incomingImageUrl,
        params.businessDisplayName,
      );
      const retryPolicy = applyOutboundPolicyGuard({
        latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
        menuSelectionActive: false,
        draftText: retryDraft.text,
      });
      const retryKbLeak = sanitizeOutboundInternalKbLeak(
        retryPolicy,
        policyContext?.latestIntent ?? 'UNKNOWN',
        kbChunks,
      );
      const retryGuard = rewriteUnsupportedBusinessClaimsWhenNoKb({
        replyText: retryKbLeak,
        kbChunksReturned: kbChunks.length,
        latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
        latestUserMessage: policyContext?.latestUserMessage ?? '',
        tenantId,
        conversationId,
        tenantPricingCorpus: policyContext?.tenantPricingCorpus ?? '',
      });
      finalDraft = retryGuard.rewritten ? retryGuard.text : retryKbLeak;
      this.logger.log(
        `conversationalHesitationSafetyRetry conversation=${conversationId} accepted=${finalDraft.trim().length > 0}`,
      );
    }
    if (!finalDraft.trim()) {
      return this.buildSkipNoReplyPlan({
        routing,
        rationale: noKbClaimGuard.rewritten
          ? `outboundSafetyBlocked=${noKbClaimGuard.reason ?? 'no_kb_claim'}`
          : `draft_blocked:${draft.fallbackReason ?? draft.provenance}`,
        draft,
      });
    }
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
    const proactiveLive = this.prepareProactiveHandoverOutboundText({
      replyText: finalDraft,
      latestIntent: policyContext?.latestIntent ?? 'UNKNOWN',
      latestUserMessage: policyContext?.latestUserMessage,
      combinedHumanMessagesText: policyContext?.combinedHumanMessagesText,
      tenantId,
      conversationId,
    });
    if (!proactiveLive.text.trim()) {
      return this.buildSkipNoReplyPlan({
        routing,
        rationale: 'draft_blocked_after_cta_strip',
        draft,
      });
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
      ...(proactiveLive.botHumanEscalationLanguageDetected
        ? { botHumanEscalationLanguageDetected: true }
        : {}),
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

  private buildSkipNoReplyPlan(params: {
    routing: RoutingResponse;
    rationale: string;
    draft?: {
      provenance?: 'live_generation' | 'placeholder_fallback' | 'policy_reply';
      fallbackReason?: 'no_agency' | 'no_provider' | 'generation_failed';
      agencyActiveProvider?: string;
      configuredModel?: string;
      routingRecommendedModel?: string;
      generationProvider?: 'MINIMAX' | 'OPENAI';
      generationModel?: string;
      generationModelActuallyUsed?: string;
      usedOpenAiFallback?: boolean;
      fallbackUsed?: boolean;
    };
  }): ReplyDecision {
    const { routing, rationale, draft } = params;
    return {
      planStatus: 'SKIP_NO_REPLY',
      responseMode: routing.responseMode,
      handoverRecommended: routing.handoverRecommended,
      confidence: routing.confidence,
      rationale,
      bubbles: [],
      suggestedActions: this.suggestActions(routing, []),
      ...(draft?.provenance ? { draftProvenance: draft.provenance } : {}),
      ...(draft?.fallbackReason ? { draftFallbackReason: draft.fallbackReason } : {}),
      ...(draft?.agencyActiveProvider ? { agencyActiveProvider: draft.agencyActiveProvider } : {}),
      ...(draft?.configuredModel ? { configuredModel: draft.configuredModel } : {}),
      ...(draft?.routingRecommendedModel ? { routingRecommendedModel: draft.routingRecommendedModel } : {}),
      ...(draft?.generationProvider ? { generationProvider: draft.generationProvider } : {}),
      ...(draft?.generationModel ? { generationModel: draft.generationModel } : {}),
      ...(draft?.generationModelActuallyUsed
        ? { generationModelActuallyUsed: draft.generationModelActuallyUsed }
        : {}),
      ...(draft?.usedOpenAiFallback ? { usedOpenAiFallback: draft.usedOpenAiFallback } : {}),
      ...(draft?.fallbackUsed != null ? { fallbackUsed: draft.fallbackUsed } : {}),
    };
  }

  /**
   * Build a draft: try live generation first; return an empty skipped draft if live generation fails.
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
    incomingImageUrl?: string | null,
    businessDisplayName?: string,
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
      incomingImageUrl,
      businessDisplayName,
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
              ...(policyContext.multiOptionSelections?.length
                ? { multiOptionSelections: policyContext.multiOptionSelections }
                : {}),
              ...(policyContext.bookingCapability
                ? { bookingCapability: policyContext.bookingCapability }
                : {}),
              ...(policyContext.handoverCapability
                ? { handoverCapability: policyContext.handoverCapability }
                : {}),
              ...(policyContext.priorAssistantMessageCount != null
                ? { priorAssistantMessageCount: policyContext.priorAssistantMessageCount }
                : {}),
              ...(policyContext.recentAssistantBookingUrlSent === true
                ? { recentAssistantBookingUrlSent: true }
                : {}),
              ...(policyContext.optionMenuSourceExcerpt?.trim()
                ? { optionMenuSourceExcerpt: policyContext.optionMenuSourceExcerpt.trim() }
                : {}),
            },
          }
        : {}),
    });
    const generation_ms = Date.now() - generationStarted;

    const outboundText = stripModelThinking(liveDraft.content ?? '').trim();
    if (outboundText.length > 0) {
      const gma = liveDraft.generationModelActuallyUsed ?? liveDraft.generationModel;
      this.logger.log(
        `Live draft generated: generation_ms=${generation_ms} ${outboundText.length} chars (generationModelActuallyUsed=${gma ?? 'n/a'}, configuredModel=${liveDraft.configuredModel ?? 'n/a'})`,
      );
      return {
        text: outboundText,
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
      (liveDraft.content !== null && outboundText.length === 0 ? 'generation_failed' : undefined);

    return {
      text: '',
      provenance: 'placeholder_fallback',
      fallbackReason,
      agencyActiveProvider: liveDraft.agencyActiveProvider,
      configuredModel: liveDraft.configuredModel,
      routingRecommendedModel: liveDraft.routingRecommendedModel ?? routing.recommendedModel,
    };
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

  private prepareProactiveHandoverOutboundText(params: {
    replyText: string;
    latestIntent: ConversationIntent;
    latestUserMessage?: string;
    combinedHumanMessagesText?: string;
    tenantId: string;
    conversationId: string;
  }): { text: string; botHumanEscalationLanguageDetected: boolean } {
    const botHumanEscalationLanguageDetected = containsBotHumanEscalationLanguage(params.replyText);
    if (botHumanEscalationLanguageDetected) {
      return { text: params.replyText, botHumanEscalationLanguageDetected: true };
    }

    const proactive = stripProactiveHandoverCtaIfNeeded({
      replyText: params.replyText,
      latestIntent: params.latestIntent,
      latestUserMessage: params.latestUserMessage,
      combinedHumanMessagesText: params.combinedHumanMessagesText,
    });
    if (proactive.removed) {
      this.logger.log(
        `proactiveHandoverCtaRemoved ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          latestIntent: params.latestIntent,
          reason: proactive.reason ?? 'proactive_handover_cta',
        })}`,
      );
    }
    return { text: proactive.text, botHumanEscalationLanguageDetected: false };
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
