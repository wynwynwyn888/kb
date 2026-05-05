// Conversation Orchestration Service — orchestrates the inbound message pipeline
// Loads tenant/runtime context, applies guards, loads memory, retrieves KB context,
// calls AI router, produces structured result for downstream layers.
// Does NOT send outbound message — that is a later layer's responsibility.

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { OrchestrationGuards } from './orchestration-guards.service';
import { ConversationMemoryLoader } from './conversation-memory-loader';
import { AiRouterService } from '../ai-router/ai-router.service';
import { KbService } from '../kb/kb.service';
import { ReplyPlannerService } from '../reply-planning/reply-planner.service';
import { ConversationsService } from '../conversations/conversations.service';
import type {
  OrchestrationInput,
  OrchestrationResult,
  GuardOutcome,
  RoutingRequest,
  MemoryEntry,
} from './dto';
import type { RoutingResponse } from './dto';
import type { ReplyDecision } from '../reply-planning/dto';
import type { RetrievalChunk, RetrievalMeta } from '../kb/dto/retrieval.dto';
import { safeLog } from '../../lib/encryption';
import { resolveBotMode, type BotOperatingMode } from '../../lib/bot-mode';
import { filterKbChunksForPolicy } from '../../lib/kb-relevance';
import {
  classifyConversationIntent,
  type ConversationIntent,
} from '../conversation-policy/conversation-intent';
import { ConversationPolicyEngineService } from '../conversation-policy/conversation-policy-engine.service';
import {
  mergePolicyIntoConversationMetadata,
  parseAisbpPolicyState,
  emptyPolicyState,
  clearAwaitingState,
  type AisbpPolicyStateV1,
} from '../conversation-policy/conversation-policy-state';
import { resolveShortSelection, shouldSkipKbForPureOptionLetterSelection } from '../conversation-policy/option-resolver';
import {
  buildOptionSelectionCustomerReply,
  parseSelectedOptionTitleDescription,
} from '../../lib/option-selection-template';
import { stripInternalGuidanceFromChunks } from '../../lib/kb-internal-guidance';
import { interpretRetrievalChunks } from '../../lib/kb-chunk-interpretation';
import { resolveOperatingHoursConflictsAmongChunks } from '../../lib/kb-operating-hours-conflict';
import { prepareCustomerFacingMenuKb, shouldCurateMenuKbContext } from '../../lib/menu-kb-curator';
import { detectOldDemoTermsInText } from '../../lib/old-demo-terms';
import { getBusinessLocalNow, resolveAppTimeZone } from '../../lib/business-time';
import { summarizeInboundTextBatch } from '../../lib/inbound-batch-intent';
import { detectRepeatedCustomerUserLines } from '../../lib/repeated-customer-message';
import {
  buildGovernorCapabilityAppendix,
  COMPLAINT_ESCALATION_REPLY,
  detectComplaintServiceIssue,
  isUnsupportedSalonScopeQuery,
} from '../../lib/outbound-safety-governor';
import { ConversationBookingFlowService } from '../booking-flow/conversation-booking-flow.service';
import { BookingSettingsService } from '../booking-settings/booking-settings.service';
import { BotProfilesService } from '../prompts/bot-profiles.service';
import {
  compactPersonaPolicyForGeneration,
  estimateApproxTokens,
} from '../../lib/compact-runtime-system-prompt';
import { shouldSkipKbShortFollowUpActiveTopic } from '../../lib/short-followup-kb';

@Injectable()
export class ConversationOrchestrationService {
  private readonly logger = new Logger(ConversationOrchestrationService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly guards: OrchestrationGuards,
    private readonly memoryLoader: ConversationMemoryLoader,
    private readonly aiRouter: AiRouterService,
    private readonly kbService: KbService,
    private readonly replyPlanner: ReplyPlannerService,
    private readonly conversationPolicy: ConversationPolicyEngineService,
    private readonly conversationsService: ConversationsService,
    private readonly bookingFlow: ConversationBookingFlowService,
    private readonly bookingSettings: BookingSettingsService,
    private readonly botProfiles: BotProfilesService,
  ) {}

  /**
   * Main orchestration entry point.
   * Called by the inbound-message processor after the inbound message is persisted.
   * Produces a structured OrchestrationResult without sending any outbound message.
   */
  async orchestrate(
    input: OrchestrationInput,
  ): Promise<OrchestrationResult> {
    const conversationId = input.conversationId;
    const webhookEventId = input.webhookEventId;

    this.logger.log(
      `Orchestration started: conversationId=${conversationId}, eventId=${webhookEventId}`,
    );

    try {
      // Step 1: Run runtime guards (bot enabled, GHL connected, etc.)
      const guardOutcome = await this.guards.runGuards(input);

      if (guardOutcome.final !== 'PROCEED') {
        const skipReason = guardOutcome.guards.find(g => g.decision !== 'PROCEED')?.reason;
        this.logger.log(
          `Orchestration skipped: outcome=${guardOutcome.final}, reason=${skipReason}`,
        );
        const logId = await this.persistOrchestrationLog(input, guardOutcome, null, null, null);
        return {
          success: false,
          outcome: guardOutcome.final,
          conversationId,
          webhookEventId,
          guards: guardOutcome,
          logId,
          error: skipReason,
        };
      }

      // Step 2: Load conversation memory
      const policyForMemory = parseAisbpPolicyState(
        input.conversation?.metadata as Record<string, unknown> | undefined,
      );
      const memPerf0 = performance.now();
      const memory = await this.memoryLoader.loadMemory(conversationId, {
        memoryResetAfterIso: policyForMemory.memoryResetAt ?? null,
      });
      const memory_load_ms = Math.round(performance.now() - memPerf0);

      const latestMsg = (input.incomingMessage.messageContent ?? '').trim();
      const batch =
        input.recentInboundBatch && input.recentInboundBatch.length > 0
          ? input.recentInboundBatch.map(m => String(m).trim()).filter(Boolean)
          : [latestMsg].filter(Boolean);
      const batchSummary = summarizeInboundTextBatch(batch);
      const latestIntent = classifyConversationIntent(latestMsg);
      const repeatMeta = detectRepeatedCustomerUserLines(memory.entries);

      const policyStatePreInit = this.conversationPolicy.parseState(input.conversation?.metadata);
      let policyStatePre = policyStatePreInit;
      if (isUnsupportedSalonScopeQuery(latestMsg)) {
        const cleared = clearAwaitingState(policyStatePreInit);
        policyStatePre = {
          ...cleared,
          activeTopic: null,
          options: undefined,
          lastAssistantOptions: undefined,
          optionsUpdatedAt: null,
          optionsSource: null,
          optionsDerivedFromChunkIds: null,
          optionsTenantId: null,
          updatedAt: new Date().toISOString(),
        };
      }

      const optionLetterToken = shouldSkipKbForPureOptionLetterSelection(policyStatePre, latestMsg);

      const deterministicOptionPick = optionLetterToken
        ? resolveShortSelection(latestMsg, policyStatePre, memory.entries)
        : null;

      let routingIntent: ConversationIntent = latestIntent;
      if (optionLetterToken) {
        routingIntent = 'SHORT_SELECTION';
      }

      let parsedDeterministicOptionLine: ReturnType<typeof parseSelectedOptionTitleDescription> | null = null;
      if (deterministicOptionPick) {
        parsedDeterministicOptionLine = parseSelectedOptionTitleDescription(deterministicOptionPick.selectedText);
        const descPresent = Boolean(parsedDeterministicOptionLine.description?.trim());
        this.logger.log(
          `optionSelectionResolved: optionSelectionResolved=true selectedOptionLabel=${deterministicOptionPick.selectedLabel} ` +
            `selectedOptionPreview=${JSON.stringify(deterministicOptionPick.selectedText.slice(0, 120))} ` +
            `selectedOptionTitle=${JSON.stringify(parsedDeterministicOptionLine.title)} ` +
            `selectedOptionDescriptionPresent=${descPresent} optionSelectionSource=lastAssistantOptions`,
        );
      }

      let retrieveQuery = latestMsg;
      let menuKbAnchor: string | undefined;
      // Universal: if user replied with a short selection AND we have option memory, expand the
      // KB query to use the selectedText (e.g. "Haircut & Styling") instead of the literal "A".
      const optionsAwaiting =
        policyStatePre.awaiting === 'menu_category_selection' ||
        policyStatePre.awaiting === 'option_selection';
      if (routingIntent === 'SHORT_SELECTION' && optionsAwaiting) {
        const sel =
          deterministicOptionPick ?? resolveShortSelection(latestMsg, policyStatePre, memory.entries);
        if (sel) {
          menuKbAnchor = sel.selectedText;
          retrieveQuery = sel.selectedText;
          this.logger.log(
            `Resolved selection for KB query: label=${sel.selectedLabel} text=${JSON.stringify(sel.selectedText.slice(0, 60))} source=${sel.source}`,
          );
        }
      } else if (batch.length > 1) {
        retrieveQuery = batchSummary.combinedText;
      }

      const usePermissiveKbFilter =
        batch.length > 1 && !(routingIntent === 'SHORT_SELECTION' && Boolean(menuKbAnchor));

      this.logger.log(
        `Inbound batch summary: inboundBatchCount=${batch.length} uniqueProviderMessageCount=${new Set(batch).size} ` +
          `combinedIntentCount=${batchSummary.combinedIntentCount} primaryIntent=${batchSummary.primaryIntent} ` +
          `secondaryIntents=${JSON.stringify(batchSummary.secondaryIntents)} ` +
          `batchOrderedMessages=${JSON.stringify(batchSummary.orderedMessages.map(s => s.slice(0, 120)))} ` +
          `intentsPerMessage=${JSON.stringify(batchSummary.intentsPerMessage)} ` +
          `conflictingIntents=${batchSummary.conflictingIntents} ` +
          `repeatedHumanTextDetected=${repeatMeta.repeatedHumanTextDetected} ` +
          `repeatedHumanTextAction=${repeatMeta.repeatedHumanTextAction}` +
          (routingIntent !== latestIntent
            ? ` routingIntent=${routingIntent} classifiedIntent=${latestIntent}`
            : ''),
      );

      const complaintDet = detectComplaintServiceIssue(latestMsg);
      if (complaintDet.triggered) {
        try {
          await this.conversationsService.pauseForHandover(
            conversationId,
            'REQUEST',
            'AI',
            `service_complaint:${complaintDet.reason}`,
          );
        } catch (e) {
          this.logger.warn(
            `complaint handover pause failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        this.logger.log(
          `complaintHandoverTriggered: ${JSON.stringify({
            conversationId,
            tenantId: input.tenantId,
            contactId: input.conversation?.contactId ?? null,
            reason: complaintDet.reason,
            tagsQueued: complaintDet.tags,
            handoverPaused: true,
          })}`,
        );

        const complaintPolicyState: AisbpPolicyStateV1 = {
          ...emptyPolicyState(),
          activeTopic: 'complaint',
          memoryResetAt: policyForMemory.memoryResetAt ?? null,
          resetVersion: policyForMemory.resetVersion ?? 0,
          updatedAt: new Date().toISOString(),
        };

        await this.persistConversationPolicyMetadata(
          conversationId,
          (input.conversation?.metadata as Record<string, unknown>) ?? {},
          complaintPolicyState,
        );

        const complaintReplyPlan: ReplyDecision = {
          planStatus: 'PLANNED',
          responseMode: 'standard',
          handoverRecommended: false,
          confidence: 0.95,
          rationale: `complaint_service_issue:${complaintDet.reason}`,
          bubbles: [{ index: 0, text: COMPLAINT_ESCALATION_REPLY }],
          suggestedActions: [
            {
              type: 'TAG_CONTACT',
              params: { tags: complaintDet.tags },
              reason: `complaint escalation (${complaintDet.reason})`,
            },
          ],
          draftProvenance: 'policy_reply',
        };

        const routingComplaint: RoutingResponse = {
          recommendedModel: 'n/a',
          responseMode: 'standard',
          draftReply: null,
          handoverRecommended: false,
          bookingIntentDetected: false,
          tagsSuggested: [],
          confidence: 1,
          reasoning: 'complaint_handover_short_circuit',
        };

        const logId = await this.persistOrchestrationLog(
          input,
          guardOutcome,
          routingComplaint,
          null,
          complaintReplyPlan,
        );

        return {
          success: true,
          outcome: 'PROCEED',
          conversationId,
          webhookEventId,
          guards: guardOutcome,
          routing: routingComplaint,
          replyPlan: complaintReplyPlan,
          logId,
        };
      }

      const bookingHook = await this.bookingFlow.maybeHandleConversationBookingTurn({
        tenantId: input.tenantId,
        conversationId,
        contactId: input.conversation?.contactId ?? '',
        channel: input.conversation?.channel ?? '',
        combinedInboundText: batchSummary.combinedText || latestMsg,
        latestInboundText: latestMsg,
        metadata: (input.conversation?.metadata as Record<string, unknown>) ?? {},
        tenantDisplayName: input.tenant?.name,
        tenantTimeZone: input.tenant?.timeZone,
        contactSnapshot:
          input.incomingMessage.contactDisplayName ||
          input.incomingMessage.contactPhone ||
          input.incomingMessage.contactEmail
            ? {
                displayName: input.incomingMessage.contactDisplayName ?? undefined,
                phone: input.incomingMessage.contactPhone ?? undefined,
                email: input.incomingMessage.contactEmail ?? undefined,
              }
            : undefined,
        contactFieldsFromExtendedWebhook: Boolean(input.incomingMessage.contactFieldsFromExtendedWebhook),
      });

      if (bookingHook.handled) {
        await this.persistConversationMetadata(conversationId, bookingHook.persistMetadata);
        const logId = await this.persistOrchestrationLog(
          input,
          guardOutcome,
          bookingHook.routing,
          null,
          bookingHook.replyPlan,
        );
        return {
          success: true,
          outcome: 'PROCEED',
          conversationId,
          webhookEventId,
          guards: guardOutcome,
          routing: bookingHook.routing,
          replyPlan: bookingHook.replyPlan,
          logId,
        };
      }

      const orchWallStartReplyPath = Date.now();

      // Step 3: Retrieve KB + intent-aware filter (query may expand for menu category selection)
      const kbSkipShortFollowUp = shouldSkipKbShortFollowUpActiveTopic({
        latestMessageTrimmed: latestMsg,
        latestIntent: routingIntent,
        activeTopic: policyStatePre.activeTopic,
        menuSelectionAnchorActive: Boolean(menuKbAnchor),
      });
      const kbSkipOptionLetter = optionLetterToken;
      let kb_retrieval_ms = 0;
      let kbAfterRetrieve: RetrievalChunk[] = [];
      let retrievalMeta: RetrievalMeta | null = null;

      const kbPerf0 = performance.now();
      if (kbSkipOptionLetter || kbSkipShortFollowUp) {
        const kbSkippedReason = kbSkipOptionLetter
          ? 'option_letter_deterministic'
          : 'short_followup_active_topic';
        this.logger.log(
          `kbSkip: conversationId=${conversationId} kbSkippedReason=${kbSkippedReason} routingIntent=${routingIntent}`,
        );
        retrievalMeta = {
          chunksReturned: 0,
          chunksConsidered: 0,
          retrievalMode: 'hybrid',
          topScore: null,
          kbQuery: retrieveQuery.slice(0, 240),
          kbSkippedReason,
        };
      } else {
        const retrieved = await this.retrieveKbContext(
          input,
          conversationId,
          routingIntent,
          {
            retrieveQuery,
            menuKbAnchor,
            kbFilterIntent: usePermissiveKbFilter ? 'UNKNOWN' : routingIntent,
            kbFilterUserMessage: usePermissiveKbFilter
              ? batchSummary.combinedText
              : (input.incomingMessage.messageContent ?? '').trim(),
          },
        );
        kbAfterRetrieve = retrieved.chunks;
        retrievalMeta = retrieved.meta;
      }
      kb_retrieval_ms = Math.round(performance.now() - kbPerf0);

      const policyState = policyStatePre;
      let kbInterpreted = interpretRetrievalChunks(kbAfterRetrieve);
      kbInterpreted = resolveOperatingHoursConflictsAmongChunks(kbInterpreted, msg =>
        this.logger.warn(msg),
      );
      let kbRanked = stripInternalGuidanceFromChunks(kbInterpreted);
      if (shouldCurateMenuKbContext({ latestIntent: routingIntent, menuKbAnchor })) {
        kbRanked = prepareCustomerFacingMenuKb(kbRanked, {
          latestUserMessage: latestMsg,
          latestIntent: routingIntent,
          menuAnchorLabel: menuKbAnchor,
        });
      }

      // Safe prompt metadata log — scan full stored prompts for legacy demo bleed; runtime uses compaction below.
      const promptForScan = `${input.promptConfig?.systemPrompt ?? ''}\n${input.agencyPolicy?.systemPrompt ?? ''}`;
      const oldDemoFinding = detectOldDemoTermsInText(promptForScan);
      this.logger.log(
        `Prompt metadata: promptConfigId=${input.promptConfig?.id ?? 'n/a'} ` +
          `promptUpdatedAt=${input.promptConfig?.updatedAt ?? 'n/a'} ` +
          `personaLengthRaw=${input.promptConfig?.systemPrompt?.length ?? 0} ` +
          `agencyPolicyLengthRaw=${input.agencyPolicy?.systemPrompt?.length ?? 0} ` +
          `businessNotesContainsOldDemoTerms=${oldDemoFinding.hit} ` +
          `oldDemoTermsFound=${JSON.stringify(oldDemoFinding.termsFound)}`,
      );

      const latestKbDocumentUpdatedAt = kbRanked.reduce<string | null>((acc, c) => {
        const raw = c.metadata['documentUpdatedAt'];
        if (typeof raw !== 'string') return acc;
        if (!acc) return raw;
        return Date.parse(raw) > Date.parse(acc) ? raw : acc;
      }, null);
      const optionMenuSourceExcerpt =
        deterministicOptionPick && optionLetterToken
          ? this.sliceLastAssistantContent(memory.entries)
          : undefined;

      const policyOutcome = this.conversationPolicy.evaluate({
        intent: routingIntent,
        incomingRaw: latestMsg,
        memory: memory.entries,
        policyState,
        kbChunksRanked: kbRanked,
        tenantDisplayName: input.tenant?.name,
        promptConfigUpdatedAtIso: input.promptConfig?.updatedAt ?? null,
        kbDocumentUpdatedAtIso: latestKbDocumentUpdatedAt,
        currentTenantId: input.tenantId ?? null,
        optionPickResolvedWithoutKb: Boolean(deterministicOptionPick && optionLetterToken),
      });
      const kbChunks = policyOutcome.kbChunks;

      this.logger.log(
        `kbSelectedForReply: selectedContextCount=${kbChunks.length} ` +
          `retrievedDocumentIds=${JSON.stringify([...new Set(kbChunks.map(c => c.documentId))])} ` +
          `retrievedSectionTitles=${JSON.stringify(
            kbChunks.map(c => {
              const st = c.metadata['sectionTitle'];
              return typeof st === 'string' && st.trim() ? st.trim() : '';
            }),
          )} ` +
          `topScores=${JSON.stringify(kbChunks.map(c => c.relevanceScore))}`,
      );

      const useOptionSelectionTemplate =
        Boolean(
          optionLetterToken &&
            deterministicOptionPick &&
            parsedDeterministicOptionLine &&
            parsedDeterministicOptionLine.title.trim().length > 0 &&
            !policyOutcome.policyForcedReply?.trim() &&
            policyOutcome.resolvedSelection,
        );

      let routing: RoutingResponse;
      let replyPlan: ReplyDecision;
      let prompt_build_ms: number;
      let routing_ms: number;
      let plan_reply_ms: number;

      if (useOptionSelectionTemplate && parsedDeterministicOptionLine) {
        const descPresentTpl = Boolean(parsedDeterministicOptionLine.description?.trim());
        this.logger.log(
          `optionSelectionTemplateUsed=true selectedOptionTitle=${JSON.stringify(parsedDeterministicOptionLine.title.trim())} ` +
            `selectedOptionDescriptionPresent=${descPresentTpl} llmSkippedForOptionSelection=true`,
        );

        routing = {
          recommendedModel: 'n/a',
          responseMode: 'fast',
          draftReply: null,
          handoverRecommended: false,
          bookingIntentDetected: false,
          tagsSuggested: [],
          confidence: 1,
          reasoning: 'deterministic_option_selection_template',
        };
        prompt_build_ms = 0;
        routing_ms = 0;
        const templateBody = buildOptionSelectionCustomerReply(parsedDeterministicOptionLine);
        const planPerf0 = performance.now();
        replyPlan = this.replyPlanner.buildOptionSelectionTemplateReply({
          conversationId,
          routing,
          templateBody,
          latestIntent: policyOutcome.latestIntent,
          latestUserMessage: latestMsg,
          menuSelectionActive: policyOutcome.menuSelectionActive,
        });
        plan_reply_ms = Math.round(performance.now() - planPerf0);
      } else {
        // Step 4: Build AI routing request (includes KB context)
        const bookingCapabilityForPrompt = await this.resolveBookingCapabilityForGovernor(input.tenantId);
        const promptPerf0 = performance.now();
        const systemPrompt = this.buildSystemPromptWithRuntimeGreeting(input, bookingCapabilityForPrompt);
        prompt_build_ms = Math.round(performance.now() - promptPerf0);

        const routingInbound = batch.length > 1 ? batchSummary.combinedText : latestMsg;
        const routingRequest = this.buildRoutingRequest(
          input,
          memory,
          systemPrompt,
          kbChunks,
          routingInbound,
        );

        // Step 5: Call AI router placeholder
        const routingPerf0 = performance.now();
        routing = await this.aiRouter.route(routingRequest);
        routing_ms = Math.round(performance.now() - routingPerf0);

        // Step 6: Build structured reply plan
        const planPerf0 = performance.now();
        replyPlan = await this.replyPlanner.planReply({
          tenantId: input.tenantId,
          routing,
          kbChunks,
          memory: memory.entries,
          systemPrompt,
          conversationId,
          channel: input.conversation?.channel ?? 'WHATSAPP',
          temperature: input.promptConfig?.temperature,
          maxTokens: input.promptConfig?.maxTokens,
          policyContext: {
            latestIntent: policyOutcome.latestIntent,
            resolvedSelection: policyOutcome.resolvedSelection,
            conversationStateSummary: policyOutcome.conversationStateSummary,
            policyForcedReply: policyOutcome.policyForcedReply,
            policyReplyKind: policyOutcome.policyReplyKind,
            menuSelectionActive: policyOutcome.menuSelectionActive,
            latestUserMessage: latestMsg,
            combinedHumanMessagesText: batch.length > 1 ? batchSummary.combinedText : undefined,
            inboundBatchCount: batch.length,
            batchPrimaryIntent: batchSummary.primaryIntent,
            batchSecondaryIntents: batchSummary.secondaryIntents,
            repeatedHumanTextDetected: repeatMeta.repeatedHumanTextDetected,
            repeatedHumanTextAction: repeatMeta.repeatedHumanTextAction,
            suppressColourRecommendations: isUnsupportedSalonScopeQuery(latestMsg),
            bookingCapability: bookingCapabilityForPrompt,
            handoverCapability: input.tenant?.ghlLocationId?.trim()
              ? 'tag_and_notify'
              : 'collect_details_only',
            ...(optionMenuSourceExcerpt ? { optionMenuSourceExcerpt } : {}),
          },
        });
        plan_reply_ms = Math.round(performance.now() - planPerf0);
      }

      // Inspect the planned reply bubbles for option lists (A/B/C, 1./2., bullets) and capture
      // them into option memory so the next user reply ("A") can be resolved against them.
      const assistantText = replyPlan.bubbles.map(b => b.text).join('\n\n');
      const stateAfterOptions = this.conversationPolicy.recordAssistantOptions(
        policyOutcome.nextPolicyState,
        assistantText,
        { tenantId: input.tenantId ?? null },
      );
      if (stateAfterOptions !== policyOutcome.nextPolicyState) {
        const labels = stateAfterOptions.options ? Object.keys(stateAfterOptions.options) : [];
        this.logger.log(
          `Option memory captured: source=${stateAfterOptions.optionsSource ?? 'n/a'} ` +
            `labels=${JSON.stringify(labels)} tenantId=${input.tenantId ?? 'n/a'}`,
        );
      }

      await this.persistConversationPolicyMetadata(
        conversationId,
        (input.conversation?.metadata as Record<string, unknown> | undefined) ?? {},
        stateAfterOptions,
      );

      this.logger.log(
        `Orchestration completed: conversationId=${conversationId}, ` +
          `agencyActiveProvider=${replyPlan.agencyActiveProvider ?? 'n/a'}, ` +
          `configuredModel=${replyPlan.configuredModel ?? 'n/a'}, ` +
          `routingRecommendedModel=${replyPlan.routingRecommendedModel ?? routing.recommendedModel ?? 'n/a'}, ` +
          `generationProvider=${replyPlan.generationProvider ?? 'n/a'}, ` +
          `generationModelActuallyUsed=${replyPlan.generationModelActuallyUsed ?? replyPlan.generationModel ?? 'n/a'}, ` +
          `mode=${routing.responseMode}, bubbles=${replyPlan.bubbles.length}, ` +
          `handover=${replyPlan.handoverRecommended}, ` +
          `draftProvenance=${replyPlan.draftProvenance ?? 'none'}` +
          (replyPlan.fallbackUsed ? ', fallbackUsed=true' : '') +
          (replyPlan.draftFallbackReason
            ? `, draftFallbackReason=${replyPlan.draftFallbackReason}`
            : '') +
          `, inboundBatchCount=${batch.length} combinedIntentCount=${batchSummary.combinedIntentCount} ` +
          `primaryIntent=${batchSummary.primaryIntent} secondaryIntents=${JSON.stringify(batchSummary.secondaryIntents)} ` +
          `intentsPerMessage=${JSON.stringify(batchSummary.intentsPerMessage)} ` +
          `replyAnsweredIntentCount=na unansweredIntentReasons=${JSON.stringify([])}`,
      );

      const ingress = input.orchestrationIngressTimings;
      const orchestration_reply_ms = Date.now() - orchWallStartReplyPath;
      this.logger.log(
        `replyPipelineTiming: conversationId=${conversationId} ` +
          `orchestrate_queue_wait_ms=${ingress?.orchestrateQueueWaitMs ?? 'na'} ` +
          `debounce_ms=${ingress?.debounceConfiguredMs ?? 'na'} ` +
          `memory_load_ms=${memory_load_ms} kb_retrieval_ms=${kb_retrieval_ms} prompt_build_ms=${prompt_build_ms} ` +
          `routing_ms=${routing_ms} plan_reply_ms=${plan_reply_ms} orchestration_reply_ms=${orchestration_reply_ms}`,
      );

      // Step 7: Persist orchestration log
      const logId = await this.persistOrchestrationLog(
        input,
        guardOutcome,
        routing,
        retrievalMeta,
        replyPlan,
      );

      return {
        success: true,
        outcome: 'PROCEED',
        conversationId,
        webhookEventId,
        guards: guardOutcome,
        routing,
        replyPlan,
        logId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `Orchestration error: conversationId=${conversationId}, error=${message}`,
      );
      try {
        const logId = await this.persistOrchestrationLog(input, { final: 'ERROR', guards: [] }, null, null, null);
        return {
          success: false,
          outcome: 'ERROR',
          conversationId,
          webhookEventId,
          guards: { final: 'ERROR', guards: [] },
          logId,
          error: message,
        };
      } catch {
        return {
          success: false,
          outcome: 'ERROR',
          conversationId,
          webhookEventId,
          guards: { final: 'ERROR', guards: [] },
          error: message,
        };
      }
    }
  }

  /**
   * Load full tenant context including bot_enabled, handover_paused, GHL connection status.
   */
  async loadTenantContext(tenantId: string): Promise<OrchestrationInput['tenant'] | null> {
    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('id, name, bot_enabled, handover_paused, ghl_location_id, settings')
      .eq('id', tenantId)
      .single();

    if (!tenant) return null;

    const settings =
      tenant.settings && typeof tenant.settings === 'object' && tenant.settings !== null
        ? (tenant.settings as Record<string, unknown>)
        : {};
    const botMode: BotOperatingMode = resolveBotMode(settings, Boolean(tenant.bot_enabled));

    return {
      id: tenant.id,
      name: tenant.name,
      botEnabled: Boolean(tenant.bot_enabled),
      botMode,
      handoverPaused: tenant.handover_paused,
      ghlLocationId: tenant.ghl_location_id,
    };
  }

  /**
   * Load active prompt config for a tenant.
   * If multiple rows are active, picks the most recently updated (same ordering as prompts UI upserts).
   */
  async loadPromptConfig(
    tenantId: string,
  ): Promise<OrchestrationInput['promptConfig']> {
    return this.botProfiles.getActivePromptForOrchestration(tenantId);
  }

  /**
   * Load agency-level system policy (if any) for a tenant.
   * Uses `agency_system_policies`: `content` is the policy body; highest `priority` wins, then newest.
   */
  async loadAgencyPolicy(
    tenantId: string,
  ): Promise<OrchestrationInput['agencyPolicy']> {
    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .single();

    if (!tenant) return null;

    const { data: rows, error } = await this.supabase
      .from('agency_system_policies')
      .select('id, name, content, priority, is_default')
      .eq('agency_id', tenant.agency_id)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      this.logger.warn(`loadAgencyPolicy: ${error.message}`);
      return null;
    }
    const policy = rows?.[0];
    if (!policy) return null;

    return {
      id: policy.id,
      systemPrompt: policy.content,
    };
  }

  /**
   * Load conversation record.
   */
  async loadConversation(
    conversationId: string,
  ): Promise<OrchestrationInput['conversation'] | null> {
    const { data: conv } = await this.supabase
      .from('conversations')
      .select('id, ghl_conversation_id, contact_id, channel, status, metadata')
      .eq('id', conversationId)
      .single();

    if (!conv) return null;

    return {
      id: conv.id,
      ghlConversationId: conv.ghl_conversation_id,
      contactId: conv.contact_id,
      channel: conv.channel,
      status: conv.status,
      metadata: (conv.metadata as Record<string, unknown>) ?? {},
    };
  }

  /**
   * Retrieve KB context for the incoming user message.
   * Returns { chunks, meta } — chunks may be empty even when meta is non-null.
   */
  private sliceLastAssistantContent(entries: MemoryEntry[], maxChars = 900): string {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.role === 'assistant' && String(e.content ?? '').trim()) {
        return String(e.content).trim().slice(0, maxChars);
      }
    }
    return '';
  }

  private async persistConversationMetadata(
    conversationId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('conversations')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (error) {
      this.logger.warn(
        `Failed to persist conversation metadata: conversationId=${conversationId} ${formatPostgrestError(error)}`,
      );
    }
  }

  private async resolveBookingCapabilityForGovernor(
    tenantId: string,
  ): Promise<'live_slot_booking' | 'collect_details_only'> {
    try {
      const bs = await this.bookingSettings.getBookingSettings(tenantId);
      if (
        bs.enabled &&
        bs.defaultGhlCalendarId?.trim() &&
        (bs.bookingMode === 'CHECK_AVAILABILITY' || bs.bookingMode === 'BOOK_AFTER_CONFIRMATION')
      ) {
        return 'live_slot_booking';
      }
    } catch {
      /* ignore */
    }
    return 'collect_details_only';
  }

  private async persistConversationPolicyMetadata(
    conversationId: string,
    prevMetadata: Record<string, unknown>,
    policyState: AisbpPolicyStateV1,
  ): Promise<void> {
    const merged = mergePolicyIntoConversationMetadata(prevMetadata, policyState);
    const { error } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (error) {
      this.logger.warn(
        `Failed to persist conversation policy metadata: conversationId=${conversationId} ${formatPostgrestError(error)}`,
      );
    }
  }

  private async retrieveKbContext(
    input: OrchestrationInput,
    conversationId: string,
    latestIntent: ConversationIntent,
    opts?: {
      retrieveQuery?: string;
      menuKbAnchor?: string;
      kbFilterIntent?: ConversationIntent;
      kbFilterUserMessage?: string;
    },
  ): Promise<{ chunks: RetrievalChunk[]; meta: RetrievalMeta | null }> {
    try {
      const retrieveQuery =
        (opts?.retrieveQuery ?? input.incomingMessage.messageContent ?? '').trim() ||
        (input.incomingMessage.messageContent ?? '').trim();

      const kbFilter = await this.botProfiles.getKbDocumentAllowlistForActiveProfile(input.tenantId);
      let documentIdAllowlist: string[] | null | undefined = undefined;
      if (kbFilter.kind === 'allowlist') {
        documentIdAllowlist = kbFilter.documentIds;
        this.logger.debug(
          `kbRetrievalVaultAccess tenant=${input.tenantId} conversation=${conversationId} ` +
            `kbVaultAccessMode=${kbFilter.kbVaultAccessMode} selectedVaultCount=${kbFilter.selectedVaultCount} ` +
            `allowedDocumentCount=${kbFilter.allowedDocumentCount}`,
        );
      } else if (kbFilter.kind === 'none') {
        documentIdAllowlist = [];
        if (kbFilter.reason === 'profileKnowledgeVaultsEmpty') {
          this.logger.warn(
            `profileKnowledgeVaultsEmpty tenant=${input.tenantId} conversation=${conversationId} ` +
              `kbVaultAccessMode=selected_vaults selectedVaultCount=0 allowedDocumentCount=0`,
          );
        } else {
          this.logger.warn(
            `KB retrieval skipped tenant=${input.tenantId} conversation=${conversationId} ` +
              `reason=${kbFilter.reason} kbVaultAccessMode=selected_vaults ` +
              `selectedVaultCount=${kbFilter.selectedVaultCount} allowedDocumentCount=0`,
          );
        }
      } else {
        this.logger.debug(
          `kbRetrievalVaultAccess tenant=${input.tenantId} conversation=${conversationId} ` +
            `kbVaultAccessMode=${kbFilter.kbVaultAccessMode} noActiveProfile=${kbFilter.noActiveProfile} ` +
            `selectedVaultCount=0 allowedDocumentCount=null`,
        );
      }

      const result = await this.kbService.retrieve({
        tenantId: input.tenantId,
        conversationId,
        query: retrieveQuery,
        topK: 5,
        intentHint: latestIntent !== 'UNKNOWN' ? latestIntent : undefined,
        documentIdAllowlist,
      });

      const filterIntent = opts?.kbFilterIntent ?? latestIntent;
      const filterUserMessage = (opts?.kbFilterUserMessage ?? input.incomingMessage.messageContent ?? '').trim();

      const { chunks: filteredChunks, rejections } = filterKbChunksForPolicy(
        filterIntent,
        filterUserMessage,
        result.chunks,
        { menuKbAnchor: opts?.menuKbAnchor },
      );
      for (const r of rejections) {
        this.logger.log(
          `KB rejected: reason=${r.reason}, latestMessage_class=${r.queryClass}, kbTitle=${r.kbTitleShort}`,
        );
      }

      const retrievedSectionTitles = filteredChunks.map(c => {
        const st = c.metadata['sectionTitle'];
        return typeof st === 'string' && st.trim() ? st.trim() : '';
      });
      const topScores = filteredChunks.map(c => c.relevanceScore);
      const documentIds = [...new Set(filteredChunks.map(c => c.documentId))];

      const meta: RetrievalMeta = {
        chunksReturned: filteredChunks.length,
        chunksConsidered: result.totalConsidered,
        retrievalMode: result.retrievalMode,
        topScore: filteredChunks[0]?.relevanceScore ?? result.chunks[0]?.relevanceScore ?? null,
        kbQuery: retrieveQuery,
        retrievedSectionTitles,
        topScores,
        documentIds,
      };

      this.logger.log(
        `KB context retrieved: kbQuery=${JSON.stringify(retrieveQuery.slice(0, 240))} selectedContextCount=${filteredChunks.length} retrievedChunkCount=${filteredChunks.length} ` +
          `retrievedSectionTitles=${JSON.stringify(retrievedSectionTitles)} topScores=${JSON.stringify(topScores)} ` +
          `retrievedDocumentIds=${JSON.stringify(documentIds)}`,
      );

      return { chunks: filteredChunks, meta };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`KB retrieval failed for conversation=${conversationId}: ${msg}`);
      return { chunks: [], meta: null };
    }
  }

  /**
   * Runtime system prompt for router + generation: compact persona/agency bodies (full text remains stored in DB).
   */
  private buildSystemPromptWithRuntimeGreeting(
    input: OrchestrationInput,
    bookingCapability: 'collect_details_only' | 'live_slot_booking',
  ): string {
    const tenantRaw = (input.promptConfig?.systemPrompt ?? '').trim();
    const agencyRaw = (input.agencyPolicy?.systemPrompt ?? '').trim();
    const compact = compactPersonaPolicyForGeneration({
      tenantPrompt: tenantRaw,
      agencyPrompt: agencyRaw,
    });

    let base = 'You are a helpful AI assistant.';
    if (compact.agencyBody.trim() && compact.tenantBody.trim()) {
      base = `${compact.agencyBody.trim()}\n\n---\n\nSubaccount bot instructions:\n${compact.tenantBody.trim()}`;
    } else if (compact.tenantBody.trim()) {
      base = compact.tenantBody.trim();
    } else if (compact.agencyBody.trim()) {
      base = compact.agencyBody.trim();
    }

    const tenantTz = input.tenant?.timeZone?.trim();
    const businessTimezone = tenantTz || resolveAppTimeZone();
    const snap = getBusinessLocalNow(businessTimezone);
    this.logger.log(
      `Runtime greeting context: resolvedTimeZone=${snap.timeZone} localDayPeriod=${snap.dayPeriod} greetingLabel=${snap.greetingLabel}`,
    );
    const block =
      `---\nCurrent local time context (use for greetings when appropriate; do not contradict):\n` +
      `- businessTimezone: ${businessTimezone}\n` +
      `- localDayPeriod: ${snap.dayPeriod}\n` +
      `- greetingLabel: ${snap.greetingLabel}\n`;
    const caps = buildGovernorCapabilityAppendix({
      bookingCapability,
      handoverCapability: input.tenant?.ghlLocationId ? 'tag_and_notify' : 'collect_details_only',
    });
    const assembled = `${base}\n\n${block}${caps}`;
    const runtimePromptCharLength = assembled.length;
    const estimatedPromptTokens = estimateApproxTokens(runtimePromptCharLength);
    this.logger.log(
      `Runtime prompt footprint: personaLengthRaw=${tenantRaw.length} agencyPolicyLengthRaw=${agencyRaw.length} ` +
        `personaCompactTruncated=${compact.tenantTruncated} agencyCompactTruncated=${compact.agencyTruncated} ` +
        `runtimePromptCharLength=${runtimePromptCharLength} estimatedPromptTokens=${estimatedPromptTokens}`,
    );
    return assembled;
  }

  private buildRoutingRequest(
    input: OrchestrationInput,
    memory: { entries: MemoryEntry[] },
    systemPrompt: string,
    kbChunks: RetrievalChunk[],
    routingInboundMessage: string,
  ): RoutingRequest {
    const incomingMessage = routingInboundMessage;
    const incomingMessageType = input.incomingMessage.messageType;

    const bookingKeywords = ['book', 'schedule', 'appointment', 'reservation', 'when', 'available'];
    const bookingIntentDetected = bookingKeywords.some(k =>
      incomingMessage.toLowerCase().includes(k),
    );

    const estimatedInputTokens = Math.ceil(
      (incomingMessage.length + systemPrompt.length) / 4,
    );

    const tenantModelOverride = input.promptConfig?.modelOverride?.trim();

    return {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      incomingMessage,
      incomingMessageType,
      systemPrompt,
      memory: memory.entries,
      kbContext: kbChunks,
      channel: input.conversation?.channel ?? 'WHATSAPP',
      handoverRecommended: false,
      bookingIntentDetected,
      estimatedInputTokens,
      ...(tenantModelOverride ? { tenantModelOverride } : {}),
    };
  }

  private async persistOrchestrationLog(
    input: OrchestrationInput,
    guardOutcome: GuardOutcome,
    routing: RoutingResponse | null,
    retrievalMeta: RetrievalMeta | null,
    replyPlan: ReplyDecision | null,
  ): Promise<string | undefined> {
    const outcomeMap: Record<GuardOutcome['final'], string> = {
      PROCEED: 'PROCEED',
      SKIP_BOT_DISABLED: 'SKIP_BOT_DISABLED',
      SKIP_GHL_DISCONNECTED: 'SKIP_GHL_DISCONNECTED',
      SKIP_AUTOMATION_PAUSED: 'SKIP_AUTOMATION_PAUSED',
      SKIP_HANDOVER_ACTIVE: 'SKIP_HANDOVER_ACTIVE',
      SKIP_QUOTA_EXHAUSTED: 'SKIP_QUOTA_EXHAUSTED',
      SKIP_UNSUPPORTED_MESSAGE_TYPE: 'SKIP_UNSUPPORTED_MESSAGE_TYPE',
      SKIP_UNSUPPORTED_CHANNEL: 'SKIP_UNSUPPORTED_CHANNEL',
      SKIP_DUPLICATE: 'SKIP_DUPLICATE',
      ERROR: 'ERROR',
    };

    const outcome = outcomeMap[guardOutcome.final] ?? 'ERROR';
    const guardReason = guardOutcome.guards
      .filter(g => g.decision !== 'PROCEED')
      .map(g => `${g.guardName}:${g.reason}`)
      .join('; ') || null;

    const metadata: Record<string, unknown> = {};
    if (retrievalMeta) {
      metadata['kbChunksReturned'] = retrievalMeta.chunksReturned;
      metadata['kbChunksConsidered'] = retrievalMeta.chunksConsidered;
      metadata['kbRetrievalMode'] = retrievalMeta.retrievalMode;
      metadata['kbTopScore'] = retrievalMeta.topScore;
      if (retrievalMeta.kbSkippedReason !== undefined) {
        metadata['kbSkippedReason'] = retrievalMeta.kbSkippedReason;
      }
      if (retrievalMeta.kbQuery !== undefined) metadata['kbQuery'] = retrievalMeta.kbQuery;
      if (retrievalMeta.retrievedSectionTitles !== undefined) {
        metadata['kbRetrievedSectionTitles'] = retrievalMeta.retrievedSectionTitles;
      }
      if (retrievalMeta.topScores !== undefined) metadata['kbTopScores'] = retrievalMeta.topScores;
      if (retrievalMeta.documentIds !== undefined) metadata['kbDocumentIds'] = retrievalMeta.documentIds;
    }
    if (replyPlan) {
      metadata['replyPlanStatus'] = replyPlan.planStatus;
      metadata['replyBubbleCount'] = replyPlan.bubbles.length;
      metadata['replyResponseMode'] = replyPlan.responseMode;
      metadata['replyHandoverRecommended'] = replyPlan.handoverRecommended;
      metadata['replyConfidence'] = replyPlan.confidence;
      metadata['replyRationale'] = replyPlan.rationale;
      // Bubble text source: placeholder_fallback is deterministic/KB/memory — not model output.
      metadata['replyDraftProvenance'] = replyPlan.draftProvenance ?? null;
      metadata['replyDraftFallbackReason'] = replyPlan.draftFallbackReason ?? null;
      metadata['routingRecommendedModel'] = replyPlan.routingRecommendedModel ?? routing?.recommendedModel ?? null;
      metadata['agencyActiveProvider'] = replyPlan.agencyActiveProvider ?? null;
      metadata['configuredModel'] = replyPlan.configuredModel ?? null;
      metadata['generationProviderUsed'] = replyPlan.generationProvider ?? null;
      metadata['generationModelUsed'] = replyPlan.generationModelActuallyUsed ?? replyPlan.generationModel ?? null;
      metadata['generationModelActuallyUsed'] = replyPlan.generationModelActuallyUsed ?? replyPlan.generationModel ?? null;
      metadata['usedOpenAiFallback'] = replyPlan.usedOpenAiFallback ?? false;
      metadata['fallbackUsed'] = replyPlan.fallbackUsed ?? replyPlan.usedOpenAiFallback ?? false;
    }

    if (input.recentInboundBatch?.length) {
      metadata['recentInboundBatch'] = input.recentInboundBatch;
    }

    // `model_chosen` stores the agency-configured default model (cost-relevant). Router recommendation is in metadata.routingRecommendedModel.
    const logData = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      conversation_id: input.conversationId,
      webhook_event_id: input.webhookEventId ?? null,
      outcome,
      guard_reason: guardReason,
      model_chosen: replyPlan?.configuredModel ?? routing?.recommendedModel ?? null,
      response_mode: routing?.responseMode ?? null,
      draft_reply: routing?.draftReply ?? null,
      handover_recommended: routing?.handoverRecommended ?? false,
      confidence: routing?.confidence ?? null,
      metadata,
    };

    const { data, error } = await this.supabase
      .from('orchestration_logs')
      .insert(logData)
      .select('id')
      .single();

    if (error) {
      this.logger.error(
        `Failed to persist orchestration log: ${safeLog({ error: formatPostgrestError(error) })}`,
      );
      return undefined;
    }

    return data.id;
  }
}
