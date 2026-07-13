// Conversation Orchestration Service — orchestrates the inbound message pipeline
// Loads tenant/runtime context, applies guards, loads memory, retrieves KB context,
// calls AI router, produces structured result for downstream layers.
// Does NOT send outbound message — that is a later layer's responsibility.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { OrchestrationGuards } from './orchestration-guards.service';
import { ConversationMemoryLoader } from './conversation-memory-loader';
import { AiRouterService } from '../ai-router/ai-router.service';
import { KbService } from '../kb/kb.service';
import { QUEUES } from '../../queues/queue.constants';
import type { KbVectorShadowJobData } from '../../queues/processors/kb-vector-shadow.processor';
import { kbVectorShadowEnabledForTenant } from '../kb/embedding/kb-vector-shadow.runner';
import {
  kbVectorContextEnabledForTenant,
  runKbVectorContext,
} from '../kb/embedding/kb-vector-context.runner';
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
import type { RetrievalChunk, RetrievalMeta, RetrievalResult } from '../kb/dto/retrieval.dto';
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
  type AisbpPolicyStateV1,
} from '../conversation-policy/conversation-policy-state';
import {
  resolveMultiSelectionBurst,
  resolveShortSelection,
  shouldSkipKbForPureOptionLetterSelection,
} from '../conversation-policy/option-resolver';
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
  detectComplaintServiceIssue,
} from '../../lib/outbound-safety-governor';
import { inferKbRetrievalIntentHint } from '../../lib/kb-intent-synonyms';
import { ConversationBookingFlowService } from '../booking-flow/conversation-booking-flow.service';
import { BookingSettingsService } from '../booking-settings/booking-settings.service';
import { HumanEscalationRuntimeService } from '../human-escalation/human-escalation-runtime.service';
import { HumanEscalationSettingsService } from '../human-escalation/human-escalation-settings.service';
import { FollowUpEngineService } from '../follow-up-engine/follow-up-engine.service';
import {
  mergeConversationMetadataForPersist,
  readConversationMetadataField,
} from '../../lib/conversation-metadata-merge';
import { containsBotHumanEscalationLanguage } from '../../lib/bot-human-escalation-language';
import { NO_SAFE_AI_REPLY_HOLDING_TEXT } from '../../lib/no-safe-ai-reply';
import { BotProfilesService } from '../prompts/bot-profiles.service';
import { safeTextPreviewForLog } from '../../lib/safe-text-preview-for-log';
import { resolveMandatoryAfterNameRoute } from '../../lib/mandatory-playbook-route';
import {
  compactPersonaPolicyForGeneration,
  estimateApproxTokens,
  compactProfileSections,
  buildCompactedPromptBody,
  budgetGlobalPolicy,
  EDITABLE_INSTRUCTION_PRIORITY_DECLARATION,
  type ProfileSections,
} from '../../lib/compact-runtime-system-prompt';
import { shouldSkipKbShortFollowUpActiveTopic } from '../../lib/short-followup-kb';
import { WHATSAPP_OUTPUT_CONTRACT_BLOCK } from '../../lib/whatsapp-output-contract';
import {
  promptCompactTruncationWarnKey,
  shouldEmitPromptCompactTruncationWarn,
} from '../../lib/prompt-compact-truncation-warn';
import { promptFootprintDebugEnabled } from '../../lib/production-log-flags';
import { buildTenantPromptFingerprint } from '../../lib/tenant-bot-profile-prompt';
import {
  isTechnicalOperatorInput,
} from '../../lib/technical-operator-input';
import { buildKbRetrievalPlans } from '../../lib/kb-compound-retrieval';
import { PIPELINE_ERROR_CODES, RetryablePipelineError } from '../../lib/pipeline-errors';

const DEFAULT_REPLY_PATH_RAG_TIMEOUT_MS = 1200;
const MIN_REPLY_PATH_RAG_TIMEOUT_MS = 250;
const MAX_REPLY_PATH_RAG_TIMEOUT_MS = 3000;
const RECENT_ASSISTANT_BOOKING_URL_RE =
  /https?:\/\/\S*(?:book|booking|appointment|calendar|schedule|calendly|meet|session)\S*/i;

class KbRetrievalTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`KB retrieval timed out after ${timeoutMs}ms`);
    this.name = 'KbRetrievalTimeoutError';
  }
}

function replyPathRagTimeoutMs(): number {
  const raw = Number(process.env['KB_REPLY_PATH_RAG_TIMEOUT_MS']);
  if (!Number.isFinite(raw)) return DEFAULT_REPLY_PATH_RAG_TIMEOUT_MS;
  return Math.max(
    MIN_REPLY_PATH_RAG_TIMEOUT_MS,
    Math.min(MAX_REPLY_PATH_RAG_TIMEOUT_MS, Math.round(raw)),
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new KbRetrievalTimeoutError(timeoutMs)), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function recentAssistantHistoryHasBookingUrl(memory: MemoryEntry[]): boolean {
  return memory
    .filter(m => m.role === 'assistant')
    .slice(-6)
    .some(m => RECENT_ASSISTANT_BOOKING_URL_RE.test(m.content ?? ''));
}

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
    private readonly humanEscalationRuntime: HumanEscalationRuntimeService,
    private readonly humanEscalationSettings: HumanEscalationSettingsService,
    private readonly followUpEngine: FollowUpEngineService,
    @Optional()
    @InjectQueue(QUEUES.KB_VECTOR_SHADOW)
    private readonly kbVectorShadowQueue?: Queue<KbVectorShadowJobData>,
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

      if (isTechnicalOperatorInput(latestMsg)) {
        const policyTopic = parseAisbpPolicyState(
          input.conversation?.metadata as Record<string, unknown> | undefined,
        ).activeTopic;
        const conversationStatus =
          typeof input.conversation?.status === 'string'
            ? input.conversation.status.trim().toUpperCase()
            : '';
        const inHumanHandover =
          conversationStatus === 'HANDOVER' ||
          policyTopic === 'handover' ||
          (await this.conversationsService.isInHandover(input.tenantId, conversationId));

        if (inHumanHandover) {
          this.logger.log(
            `technicalOperatorInputHandoverShortCircuit ${JSON.stringify({
              conversationId,
              tenantId: input.tenantId,
            })}`,
          );
          const handoverGuardOutcome: GuardOutcome = {
            final: 'SKIP_HANDOVER_ACTIVE',
            guards: [
              {
                decision: 'SKIP_HANDOVER_ACTIVE',
                guardName: 'technical_operator_input',
                reason: 'Technical/server input during human handover',
              },
            ],
          };
          const logId = await this.persistOrchestrationLog(
            input,
            handoverGuardOutcome,
            null,
            null,
            null,
          );
          return {
            success: false,
            outcome: 'SKIP_HANDOVER_ACTIVE',
            conversationId,
            webhookEventId,
            guards: handoverGuardOutcome,
            logId,
            error: 'Technical operator input during handover',
          };
        }

        // Outside handover: let tenant prompts handle the response naturally.
      }

      const batch =
        input.recentInboundBatch && input.recentInboundBatch.length > 0
          ? input.recentInboundBatch.map(m => String(m).trim()).filter(Boolean)
          : [latestMsg].filter(Boolean);
      const batchSummary = summarizeInboundTextBatch(batch);
      const latestIntent = classifyConversationIntent(latestMsg);
      const repeatMeta = detectRepeatedCustomerUserLines(memory.entries);

      const policyStatePreInit = this.conversationPolicy.parseState(input.conversation?.metadata);
      const policyStatePre = policyStatePreInit;

      const optionLetterToken = shouldSkipKbForPureOptionLetterSelection(policyStatePre, latestMsg);
      const multiOptionBurst = resolveMultiSelectionBurst(batch, policyStatePre, memory.entries);
      const multiOptionContext = multiOptionBurst
        ? [
            'The customer selected multiple choices from the immediately preceding assistant menu:',
            ...multiOptionBurst.selections.map(
              selection => `${selection.raw}. ${selection.selectedText}`,
            ),
          ].join('\n')
        : null;

      const deterministicOptionPick = optionLetterToken
        ? resolveShortSelection(latestMsg, policyStatePre, memory.entries)
        : null;

      let routingIntent: ConversationIntent = latestIntent;
      if (optionLetterToken || multiOptionBurst) {
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

      let retrieveQuery = multiOptionContext ?? latestMsg;
      let menuKbAnchor: string | undefined;
      // Universal: if user replied with a short selection AND we have option memory, expand the
      // KB query uses the tenant-provided selectedText instead of the literal option letter.
      const optionsAwaiting =
        policyStatePre.awaiting === 'menu_category_selection' ||
        policyStatePre.awaiting === 'option_selection';
      if (multiOptionBurst && multiOptionContext) {
        menuKbAnchor = multiOptionBurst.selections.map(selection => selection.selectedText).join('\n');
        retrieveQuery = multiOptionContext;
      } else if (routingIntent === 'SHORT_SELECTION' && optionsAwaiting) {
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
          `batchOrderedMessages=${JSON.stringify(
            batchSummary.orderedMessages.map(s =>
              safeTextPreviewForLog(s, { hashSalt: 'batchOrderedMessage' }),
            ),
          )} ` +
          `intentsPerMessage=${JSON.stringify(batchSummary.intentsPerMessage)} ` +
          `conflictingIntents=${batchSummary.conflictingIntents} ` +
          `repeatedHumanTextDetected=${repeatMeta.repeatedHumanTextDetected} ` +
          `repeatedHumanTextAction=${repeatMeta.repeatedHumanTextAction}` +
          (routingIntent !== latestIntent
            ? ` routingIntent=${routingIntent} classifiedIntent=${latestIntent}`
            : ''),
      );

      let complaintContext: { handoverPaused: boolean; reason: string; tags: string[] } | null = null;
      const complaintDet = detectComplaintServiceIssue(latestMsg);
      if (complaintDet.triggered) {
        let complaintHandoverPaused = false;
        try {
          const escSettings = await this.humanEscalationSettings.getSettings(input.tenantId);
          if (escSettings.enabled) {
            await this.conversationsService.pauseForHandover(
              input.tenantId,
              conversationId,
              'REQUEST',
              'AI',
              `service_complaint:${complaintDet.reason}`,
            );
            complaintHandoverPaused = true;
            await this.followUpEngine.cancelPendingJobsForHumanEscalation({
              tenantId: input.tenantId,
              conversationId,
            });
            try {
              await this.humanEscalationRuntime.stageStaffAlertForComplaint({
                tenantId: input.tenantId,
                conversationId,
                contactId: input.conversation?.contactId ?? null,
                latestInboundMessage: latestMsg,
                memoryEntries: memory.entries,
                contactPhone: input.incomingMessage.contactPhone ?? null,
                contactDisplayName: input.incomingMessage.contactDisplayName ?? null,
                reason: complaintDet.reason,
              });
            } catch (e) {
              this.logger.warn(
                `complaintStaffAlertFailed ${JSON.stringify({
                  conversationId,
                  message: e instanceof Error ? e.message : String(e),
                })}`,
              );
            }
          }
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
            handoverPaused: complaintHandoverPaused,
          })}`,
        );

        const complaintPolicyState: AisbpPolicyStateV1 = {
          ...emptyPolicyState(),
          activeTopic: 'complaint',
          memoryResetAt: policyForMemory.memoryResetAt ?? null,
          resetVersion: policyForMemory.resetVersion ?? 0,
          updatedAt: new Date().toISOString(),
        };

        await this.persistConversationPolicyMetadata(conversationId, complaintPolicyState);

        // Pass complaint through normal AI generation; tenant Escalation Behaviour + Persona + Business Notes control the reply.
        complaintContext = { handoverPaused: complaintHandoverPaused, reason: complaintDet.reason, tags: complaintDet.tags };
        routingIntent = 'COMPLAINT';

        this.logger.log(
          `complaintRoutingToAi: ${JSON.stringify({
            conversationId,
            tenantId: input.tenantId,
            complaintReason: complaintDet.reason,
            handoverPaused: complaintHandoverPaused,
            replyProvenance: 'ai_complaint_generated',
          })}`,
        );
      }

      let handoverContext: { escalated: boolean } | null = null;
      if (routingIntent === 'HUMAN_HANDOVER') {
        let humanEscalationActive = false;
        try {
          const escalation = await this.humanEscalationRuntime.onHumanHandoverIntent({
            tenantId: input.tenantId,
            tenantDisplayName: input.tenant?.name,
            conversationId,
            contactId: input.conversation?.contactId ?? null,
            latestInboundMessage: latestMsg,
            memoryEntries: memory.entries,
            contactPhone: input.incomingMessage.contactPhone ?? null,
            contactDisplayName: input.incomingMessage.contactDisplayName ?? null,
          });
          humanEscalationActive = escalation.escalated;
        } catch (e) {
          this.logger.warn(
            `humanEscalationRuntimeFailed ${JSON.stringify({
              conversationId,
              message: e instanceof Error ? e.message : String(e),
            })}`,
          );
        }

        if (humanEscalationActive) {
          const policyOutcomeHuman = this.conversationPolicy.evaluate({
            intent: routingIntent,
            incomingRaw: latestMsg,
            memory: memory.entries,
            policyState: policyStatePre,
            kbChunksRanked: [],
            tenantDisplayName: input.tenant?.name,
            promptConfigUpdatedAtIso: input.promptConfig?.updatedAt ?? null,
            kbDocumentUpdatedAtIso: null,
            currentTenantId: input.tenantId ?? null,
          });

          await this.persistConversationPolicyMetadata(
            conversationId,
            policyOutcomeHuman.nextPolicyState,
          );
        }

        // Pass through normal AI generation; tenant Escalation Behaviour + Persona control the conversational reply.
        handoverContext = { escalated: humanEscalationActive };

        this.logger.log(
          `humanHandoverRoutingToAi: ${JSON.stringify({
            conversationId,
            tenantId: input.tenantId,
            escalated: humanEscalationActive,
            replyProvenance: 'ai_handover_generated',
          })}`,
        );
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
        incomingRaw: multiOptionContext ?? latestMsg,
        memory: memory.entries,
        policyState,
        kbChunksRanked: kbRanked,
        tenantDisplayName: input.tenant?.name,
        promptConfigUpdatedAtIso: input.promptConfig?.updatedAt ?? null,
        kbDocumentUpdatedAtIso: latestKbDocumentUpdatedAt,
        currentTenantId: input.tenantId ?? null,
        optionPickResolvedWithoutKb: Boolean(
          (deterministicOptionPick && optionLetterToken) || multiOptionBurst,
        ),
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
            !multiOptionBurst &&
            deterministicOptionPick &&
            parsedDeterministicOptionLine &&
            parsedDeterministicOptionLine.title.trim().length > 0 &&
            !policyOutcome.policyForcedReply?.trim() &&
            policyOutcome.resolvedSelection,
        );
      const mandatoryAfterNameRoute = resolveMandatoryAfterNameRoute({
        memory: memory.entries,
        latestMessage: latestMsg,
        salesPlaybook: input.promptConfig?.profileSections?.['salesPlaybook'],
      });

      let routing: RoutingResponse;
      let replyPlan: ReplyDecision;
      let prompt_build_ms: number;
      let routing_ms: number;
      let plan_reply_ms: number;

      if (mandatoryAfterNameRoute && !policyOutcome.policyForcedReply?.trim()) {
        this.logger.log(
          `mandatoryPlaybookTemplateUsed=true route=after_name llmSkipped=true tenantId=${input.tenantId}`,
        );
        routing = {
          recommendedModel: 'n/a',
          responseMode: 'fast',
          draftReply: null,
          handoverRecommended: false,
          bookingIntentDetected: false,
          tagsSuggested: [],
          confidence: 1,
          reasoning: 'mandatory_playbook_after_name_template',
        };
        prompt_build_ms = 0;
        routing_ms = 0;
        const planPerf0 = performance.now();
        replyPlan = this.replyPlanner.buildMandatoryPlaybookTemplateReply({
          tenantId: input.tenantId,
          conversationId,
          routing,
          templateBody: mandatoryAfterNameRoute.replyText,
          latestIntent: policyOutcome.latestIntent,
          latestUserMessage: latestMsg,
        });
        plan_reply_ms = Math.round(performance.now() - planPerf0);
      } else if (useOptionSelectionTemplate && parsedDeterministicOptionLine) {
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
          tenantId: input.tenantId,
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

        const routingInbound = multiOptionContext ?? (batch.length > 1 ? batchSummary.combinedText : latestMsg);
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
          businessDisplayName: input.tenant?.name,
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
            combinedHumanMessagesText:
              multiOptionContext ?? (batch.length > 1 ? batchSummary.combinedText : undefined),
            inboundBatchCount: batch.length,
            batchPrimaryIntent: batchSummary.primaryIntent,
            batchSecondaryIntents: batchSummary.secondaryIntents,
            repeatedHumanTextDetected: repeatMeta.repeatedHumanTextDetected,
            repeatedHumanTextAction: repeatMeta.repeatedHumanTextAction,
            bookingCapability: bookingCapabilityForPrompt,
            handoverCapability: input.tenant?.ghlLocationId?.trim()
              ? 'tag_and_notify'
              : 'collect_details_only',
            priorAssistantMessageCount: memory.entries.filter(m => m.role === 'assistant').length,
            recentAssistantBookingUrlSent: recentAssistantHistoryHasBookingUrl(memory.entries),
            ...(optionMenuSourceExcerpt ? { optionMenuSourceExcerpt } : {}),
            ...(multiOptionBurst
              ? {
                  multiOptionSelections: multiOptionBurst.selections.map(selection => ({
                    label: selection.raw,
                    text: selection.selectedText,
                  })),
                }
              : {}),
            tenantPricingCorpus: [
              input.promptConfig?.businessNotes?.trim(),
              input.promptConfig?.systemPrompt?.trim(),
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
          incomingImageUrl: input.incomingMessage.imageMediaUrl ?? null,
        });
        plan_reply_ms = Math.round(performance.now() - planPerf0);
      }

      replyPlan = await this.maybeEscalateFromBotReplyLanguage({
        input,
        conversationId,
        latestMsg,
        memoryEntries: memory.entries,
        replyPlan,
        routingIntent,
      });
      replyPlan = await this.maybeEscalateNoReplyPlan({
        input,
        conversationId,
        latestMsg,
        memoryEntries: memory.entries,
        replyPlan,
      });

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

      await this.persistConversationPolicyMetadata(conversationId, stateAfterOptions);

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
        await this.persistOrchestrationLog(input, { final: 'ERROR', guards: [] }, null, null, null);
      } catch {
        // The original failure must still reach BullMQ even when error logging fails.
      }
      if (error instanceof RetryablePipelineError) throw error;
      throw new RetryablePipelineError(
        message,
        PIPELINE_ERROR_CODES.ORCHESTRATION_FAILED,
        error,
      );
    }
  }

  /**
   * When outbound copy promises human/team follow-up, run the same escalation side effects as an
   * explicit customer handover request (when tenant human escalation automation is enabled).
   */
  private async maybeEscalateFromBotReplyLanguage(params: {
    input: OrchestrationInput;
    conversationId: string;
    latestMsg: string;
    memoryEntries: MemoryEntry[];
    replyPlan: ReplyDecision;
    routingIntent: ConversationIntent;
  }): Promise<ReplyDecision> {
    const { input, conversationId, latestMsg, memoryEntries, routingIntent } = params;
    let { replyPlan } = params;

    if (routingIntent === 'HUMAN_HANDOVER' || replyPlan.draftProvenance === 'human_escalation') {
      return replyPlan;
    }
    if (replyPlan.planStatus !== 'PLANNED' || replyPlan.bubbles.length === 0) {
      return replyPlan;
    }

    const assistantText = replyPlan.bubbles.map(b => b.text).join('\n\n');
    const detected =
      replyPlan.botHumanEscalationLanguageDetected === true ||
      containsBotHumanEscalationLanguage(assistantText);
    if (!detected) {
      return replyPlan;
    }

    this.logger.log(
      `humanEscalationBotReplyLanguageDetected ${JSON.stringify({
        conversationId,
        tenantId: input.tenantId,
      })}`,
    );

    try {
      const escalation = await this.humanEscalationRuntime.onHumanHandoverIntent({
        tenantId: input.tenantId,
        tenantDisplayName: input.tenant?.name,
        conversationId,
        contactId: input.conversation?.contactId ?? null,
        latestInboundMessage: latestMsg,
        memoryEntries,
        contactPhone: input.incomingMessage.contactPhone ?? null,
        contactDisplayName: input.incomingMessage.contactDisplayName ?? null,
        handoverReason: 'bot_reply:HUMAN_ESCALATION_PROMISE',
        summaryFallback: 'The assistant indicated that a team member will follow up.',
      });

      if (escalation.escalated) {
        replyPlan = {
          ...replyPlan,
          responseMode: 'handover',
          handoverRecommended: true,
          rationale: 'bot_reply:HUMAN_ESCALATION_PROMISE',
          draftProvenance: 'human_escalation',
        };
        this.logger.log(
          `humanEscalationBotReplyEscalated ${JSON.stringify({
            conversationId,
            tenantId: input.tenantId,
          })}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `humanEscalationBotReplyRuntimeFailed ${JSON.stringify({
          conversationId,
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
    }

    return replyPlan;
  }

  /**
   * Customer enquiries should never disappear. General contextual replies are already allowed
   * without KB grounding. If a business-specific reply cannot be produced safely, send the
   * deterministic holding acknowledgement and route the conversation to human takeover.
   */
  private async maybeEscalateNoReplyPlan(params: {
    input: OrchestrationInput;
    conversationId: string;
    latestMsg: string;
    memoryEntries: MemoryEntry[];
    replyPlan: ReplyDecision;
  }): Promise<ReplyDecision> {
    const { input, conversationId, latestMsg, memoryEntries } = params;
    const replyPlan = params.replyPlan;
    if (replyPlan.planStatus !== 'SKIP_NO_REPLY' && replyPlan.bubbles.length > 0) {
      return replyPlan;
    }
    if (replyPlan.handoverRecommended || replyPlan.draftProvenance === 'human_escalation') {
      return replyPlan;
    }

    this.logger.warn(
      `noSafeAiReplyEscalatingToHuman ${JSON.stringify({
        conversationId,
        tenantId: input.tenantId,
        planStatus: replyPlan.planStatus,
        draftProvenance: replyPlan.draftProvenance ?? null,
        draftFallbackReason: replyPlan.draftFallbackReason ?? null,
        rationale: replyPlan.rationale,
      })}`,
    );

    let escalated = false;
    try {
      const result = await this.humanEscalationRuntime.onHumanHandoverIntent({
        tenantId: input.tenantId,
        tenantDisplayName: input.tenant?.name,
        conversationId,
        contactId: input.conversation?.contactId ?? null,
        latestInboundMessage: latestMsg,
        memoryEntries,
        contactPhone: input.incomingMessage.contactPhone ?? null,
        contactDisplayName: input.incomingMessage.contactDisplayName ?? null,
        handoverReason: 'no_safe_ai_reply',
        summaryFallback: 'The AI could not produce a safe grounded reply. Please review and respond to the customer.',
      });
      escalated = result.escalated;
    } catch (e) {
      this.logger.warn(
        `noSafeAiReplyEscalationRuntimeFailed ${JSON.stringify({
          conversationId,
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
    }

    if (!escalated) {
      try {
        await this.conversationsService.pauseForHandover(
          input.tenantId,
          conversationId,
          'REQUEST',
          'AI',
          'no_safe_ai_reply',
        );
        escalated = true;
      } catch (e) {
        this.logger.warn(
          `noSafeAiReplyPauseFailed ${JSON.stringify({
            conversationId,
            message: e instanceof Error ? e.message : String(e),
          })}`,
        );
      }
    }

    return {
      ...replyPlan,
      planStatus: 'PLANNED',
      responseMode: 'handover',
      handoverRecommended: escalated,
      rationale: `${replyPlan.rationale}; holdingReply=no_safe_ai_reply; humanTakeover=no_safe_ai_reply`,
      bubbles: [{ index: 0, text: NO_SAFE_AI_REPLY_HOLDING_TEXT }],
      suggestedActions: [
        ...replyPlan.suggestedActions,
        {
          type: 'ESCALATE',
          params: { reason: 'no_safe_ai_reply' },
          reason: 'AI could not produce a safe grounded reply',
        },
      ],
      draftProvenance: 'human_escalation',
    };
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
    const { data, error: readError } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (readError) {
      this.logger.warn(
        `Failed to load conversation metadata for persist: conversationId=${conversationId} ${formatPostgrestError(readError)}`,
      );
      return;
    }
    const current = readConversationMetadataField(data?.metadata);
    const merged = mergeConversationMetadataForPersist(current, metadata);
    const { error } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: new Date().toISOString() })
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
    policyState: AisbpPolicyStateV1,
  ): Promise<void> {
    const { data, error: readError } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (readError) {
      this.logger.warn(
        `Failed to load conversation metadata for policy persist: conversationId=${conversationId} ${formatPostgrestError(readError)}`,
      );
      return;
    }
    const prev =
      data?.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};
    const policyPatch = mergePolicyIntoConversationMetadata(prev, policyState);
    const merged = mergeConversationMetadataForPersist(prev, policyPatch);
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
    const retrieveQuery =
      (opts?.retrieveQuery ?? input.incomingMessage.messageContent ?? '').trim() ||
      (input.incomingMessage.messageContent ?? '').trim();
    const timeoutMs = replyPathRagTimeoutMs();
    try {
      return await withTimeout(
        this.retrieveKbContextWithinBudget(input, conversationId, latestIntent, {
          ...opts,
          retrieveQuery,
        }),
        timeoutMs,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown';
      const kbSkippedReason =
        error instanceof KbRetrievalTimeoutError ? `timeout_${timeoutMs}ms` : 'retrieval_error';
      this.logger.warn(
        `KB retrieval fail-open for conversation=${conversationId}: reason=${kbSkippedReason} error=${msg}`,
      );
      return {
        chunks: [],
        meta: {
          chunksReturned: 0,
          chunksConsidered: 0,
          retrievalMode: 'hybrid',
          topScore: null,
          kbQuery: retrieveQuery.slice(0, 240),
          kbSkippedReason,
        },
      };
    }
  }

  private async retrieveKbContextWithinBudget(
    input: OrchestrationInput,
    conversationId: string,
    latestIntent: ConversationIntent,
    opts: {
      retrieveQuery: string;
      menuKbAnchor?: string;
      kbFilterIntent?: ConversationIntent;
      kbFilterUserMessage?: string;
    },
  ): Promise<{ chunks: RetrievalChunk[]; meta: RetrievalMeta | null }> {
    const retrieveQuery = opts.retrieveQuery;
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

    const retrievalPlans = buildKbRetrievalPlans(retrieveQuery, latestIntent);
    const primaryPlan = retrievalPlans[0] ?? {
      query: retrieveQuery,
      intent: latestIntent,
      source: 'primary' as const,
    };
    const kbIntentHint =
      primaryPlan.intent !== 'UNKNOWN'
        ? primaryPlan.intent
        : inferKbRetrievalIntentHint(primaryPlan.query) ?? undefined;

    this.logger.debug(
      `kbRetrieveIntentHint tenant=${input.tenantId} conversation=${conversationId} ` +
        `classifiedIntent=${latestIntent} intentHint=${kbIntentHint ?? 'none'} ` +
        `retrieveQueryPreview=${JSON.stringify(
          safeTextPreviewForLog(primaryPlan.query, { hashSalt: 'retrieveQueryPreview' }),
        )}`,
    );

    const retrievedByPlan: Array<{
      plan: typeof primaryPlan;
      result: RetrievalResult;
      usedVectorContext: boolean;
    }> = [];

    for (const plan of retrievalPlans.length ? retrievalPlans : [primaryPlan]) {
      const intentHint =
        plan.intent !== 'UNKNOWN' ? plan.intent : inferKbRetrievalIntentHint(plan.query) ?? undefined;
      let result = await this.kbService.retrieve({
        tenantId: input.tenantId,
        conversationId,
        query: plan.query,
        topK: plan.source === 'primary' ? 5 : 3,
        intentHint,
        documentIdAllowlist,
      });

      // RAG shadow lane (diagnostic-only, default OFF, fail-closed per tenant).
      // Enqueue a fire-and-forget job onto the dedicated KB_VECTOR_SHADOW queue.
      // ALL OpenAI/RPC work happens in that worker, NEVER inline on this reply
      // request. The enqueue is non-awaited and its failure is swallowed, so it
      // can never inject/reorder/replace/delay/error the reply. Flag-off => no
      // enqueue and a byte-identical `result`.
      if (kbVectorShadowEnabledForTenant(input.tenantId) && this.kbVectorShadowQueue) {
        const keywordCandidates = result.chunks.map((c) => ({
          chunkId: c.chunkId,
          score: c.relevanceScore,
        }));
        void this.kbVectorShadowQueue
          .add('kb-vector-shadow', {
            tenantId: input.tenantId,
            conversationId,
            query: plan.query,
            intentHint,
            documentIdAllowlist: documentIdAllowlist ?? null,
            keywordCandidates,
          })
          .catch(() => undefined);
      }

      retrievedByPlan.push({ plan, result, usedVectorContext: false });
    }

    if (retrievedByPlan.length === 1 && kbVectorContextEnabledForTenant(input.tenantId)) {
      const vectorContext = await runKbVectorContext(
        { tenantId: input.tenantId, conversationId, query: primaryPlan.query, documentIdAllowlist, topK: 5 },
        { logger: this.logger },
      );
      if (vectorContext.ok) {
        retrievedByPlan[0] = {
          plan: primaryPlan,
          result: vectorContext.result,
          usedVectorContext: true,
        };
      } else {
        this.logger.log(
          `kbVectorContextFallback tenant=${input.tenantId} conversation=${conversationId} reason=${vectorContext.reason}`,
        );
      }
    }

    const filterIntent = opts?.kbFilterIntent ?? latestIntent;
    const filterUserMessage = (opts?.kbFilterUserMessage ?? input.incomingMessage.messageContent ?? '').trim();

    const mergedChunks = new Map<string, RetrievalChunk>();
    let chunksConsidered = 0;
    let rawTopScore: number | null = null;
    const retrievalModes = new Set<RetrievalResult['retrievalMode']>();
    for (const { plan, result, usedVectorContext } of retrievedByPlan) {
      chunksConsidered += result.totalConsidered;
      rawTopScore ??= result.chunks[0]?.relevanceScore ?? null;
      retrievalModes.add(result.retrievalMode);
      const planFilterIntent = plan.source === 'primary' ? filterIntent : plan.intent;
      const planFilterUserMessage = plan.source === 'primary' ? filterUserMessage : plan.query;
      const { chunks, rejections } = usedVectorContext
        ? { chunks: result.chunks, rejections: [] }
        : filterKbChunksForPolicy(planFilterIntent, planFilterUserMessage, result.chunks, {
            menuKbAnchor: opts?.menuKbAnchor,
          });

      for (const r of rejections) {
        this.logger.log(
          `KB rejected: reason=${r.reason}, latestMessage_class=${r.queryClass}, kbTitle=${r.kbTitleShort}`,
        );
      }
      for (const chunk of chunks) {
        const existing = mergedChunks.get(chunk.chunkId);
        if (!existing || chunk.relevanceScore > existing.relevanceScore) {
          mergedChunks.set(chunk.chunkId, chunk);
        }
      }
    }
    const filteredChunks = [...mergedChunks.values()].slice(0, 10);

    const retrievedSectionTitles = filteredChunks.map(c => {
      const st = c.metadata['sectionTitle'];
      return typeof st === 'string' && st.trim() ? st.trim() : '';
    });
    const topScores = filteredChunks.map(c => c.relevanceScore);
    const documentIds = [...new Set(filteredChunks.map(c => c.documentId))];
    const retrievalMode =
      retrievalModes.size === 1 ? [...retrievalModes][0] ?? 'keyword' : 'hybrid';
    const kbSubqueries = retrievalPlans
      .filter(plan => plan.source === 'focused')
      .map(plan => plan.query);
    const kbIntentHints = [...new Set(retrievalPlans.map(plan => plan.intent))];

    const meta: RetrievalMeta = {
      chunksReturned: filteredChunks.length,
      chunksConsidered,
      retrievalMode,
      topScore: filteredChunks[0]?.relevanceScore ?? rawTopScore,
      kbQuery: primaryPlan.query,
      retrievedSectionTitles,
      topScores,
      documentIds,
      kbSubqueries: kbSubqueries.length ? kbSubqueries : undefined,
      kbIntentHints,
    };

    this.logger.log(
      `KB context retrieved: kbQuery=${JSON.stringify(
        safeTextPreviewForLog(primaryPlan.query, { hashSalt: 'kbQuery' }),
      )} retrievalPlanCount=${retrievalPlans.length || 1} selectedContextCount=${filteredChunks.length} retrievedChunkCount=${filteredChunks.length} ` +
        `retrievedSectionTitles=${JSON.stringify(retrievedSectionTitles)} topScores=${JSON.stringify(topScores)} ` +
        `retrievedDocumentIds=${JSON.stringify(documentIds)} kbSubqueries=${JSON.stringify(kbSubqueries)}`,
    );

    return { chunks: filteredChunks, meta };
  }

  /**
   * Runtime system prompt for router + generation: compact persona/agency bodies (full text remains stored in DB).
   */
  private buildSystemPromptWithRuntimeGreeting(
    input: OrchestrationInput,
    bookingCapability: 'collect_details_only' | 'live_slot_booking',
  ): string {
    // Field-level section budgets are the primary runtime path. It applies whenever the active
    // profile exposes per-section fields, which is the norm. Only pure-legacy tenants (a stored
    // blob with no `profileSections`) fall back to the old single-blob compaction.
    const useSectionBudgets = Boolean(input.promptConfig?.profileSections);
    const globalPolicyRaw = (input.agencyPolicy?.systemPrompt ?? '').trim();
    const includesGlobalPolicy = globalPolicyRaw.length > 0;

    // Debug-safe prompt fingerprint (lengths + hash only) so live WhatsApp can be compared with the
    // Preview Bot for parity. The hash is channel-agnostic (tenant fields only); global-policy and
    // section-length signals are logged separately so they never affect cross-channel parity.
    const fp = buildTenantPromptFingerprint(
      input.promptConfig?.profileSections as Record<string, string | undefined> | null | undefined,
    );

    const tenantTz = input.tenant?.timeZone?.trim();
    const businessTimezone = tenantTz || resolveAppTimeZone();
    const snap = getBusinessLocalNow(businessTimezone);
    const block =
      `---\nCurrent local time context (use for greetings when appropriate; do not contradict):\n` +
      `- businessTimezone: ${businessTimezone}\n` +
      `- localDayPeriod: ${snap.dayPeriod}\n` +
      `- greetingLabel: ${snap.greetingLabel}\n`;
    const caps = buildGovernorCapabilityAppendix({
      bookingCapability,
      handoverCapability: input.tenant?.ghlLocationId ? 'tag_and_notify' : 'collect_details_only',
    });
    const whatsappBlock = WHATSAPP_OUTPUT_CONTRACT_BLOCK;

    if (useSectionBudgets && input.promptConfig?.profileSections) {
      // Primary path: Global Prompt injected separately, then per-field-budgeted tenant sections.
      const sections: ProfileSections = input.promptConfig.profileSections;
      const compacted = compactProfileSections(sections);
      const tenantBody = buildCompactedPromptBody(compacted);
      // Global policy is its own layer with its own budget — never squeezed into the tenant blob.
      const global = budgetGlobalPolicy(globalPolicyRaw);

      const layers: string[] = [EDITABLE_INSTRUCTION_PRIORITY_DECLARATION];
      if (global.text) layers.push(`Global policy (applies before subaccount instructions):\n${global.text}`);
      if (tenantBody) layers.push(tenantBody);
      const base = layers.join('\n\n---\n\n');
      const assembled = `${base}\n\n${block}${caps}`;

      this.logger.log(
        `promptFingerprint channel=whatsapp tenantId=${input.tenantId} ` +
          `profileId=${input.promptConfig?.id ?? 'none'} profileUpdatedAt=${input.promptConfig?.updatedAt ?? 'none'} ` +
          `hash=${fp.hash} sectionBudgetsPath=true includesGlobalPolicy=${includesGlobalPolicy} ` +
          `includesCriticalFacts=${fp.includesCriticalFacts} includesPersona=${fp.includesPersona} ` +
          `includesGoals=${fp.includesGoals} includesBusinessNotes=${fp.includesBusinessNotes} ` +
          `includesBookingBehavior=${fp.includesBookingBehavior} includesEscalationBehavior=${fp.includesEscalationBehavior} ` +
          `globalPolicyLen=${global.text.length} globalPolicyTruncated=${global.truncated} ` +
          `budgetedSectionLengths=${JSON.stringify(
            Object.fromEntries(Object.entries(compacted.sections).map(([k, v]) => [k, v.length])),
          )} anySectionTruncated=${Object.values(compacted.truncated).some(Boolean)} ` +
          `totalTenantChars=${compacted.totalChars}`,
      );

      if (promptFootprintDebugEnabled()) {
        this.logger.log(
          `Runtime prompt footprint (section budgets): ` +
            Object.entries(compacted.sections).map(([k, v]) => `${k}Len=${v.length}`).join(' ') + ' ' +
            `globalPolicyLen=${global.text.length} ` +
            `anyTruncated=${Object.values(compacted.truncated).some(Boolean) || global.truncated} ` +
            `totalTenantCharLength=${compacted.totalChars} ` +
            `runtimePromptCharLength=${assembled.length} ` +
            `estimatedPromptTokens=${estimateApproxTokens(assembled.length)}`,
        );
      }

      return `${assembled}\n\n${whatsappBlock}`;
    }

    // Legacy fallback (pure-legacy tenants only): single stored blob, no per-section fields.
    this.logger.log(
      `promptFingerprint channel=whatsapp tenantId=${input.tenantId} ` +
        `profileId=${input.promptConfig?.id ?? 'none'} profileUpdatedAt=${input.promptConfig?.updatedAt ?? 'none'} ` +
        `hash=${fp.hash} sectionBudgetsPath=false includesGlobalPolicy=${includesGlobalPolicy} ` +
        `includesCriticalFacts=${fp.includesCriticalFacts} includesPersona=${fp.includesPersona} ` +
        `includesGoals=${fp.includesGoals} includesBusinessNotes=${fp.includesBusinessNotes} ` +
        `includesBookingBehavior=${fp.includesBookingBehavior} includesEscalationBehavior=${fp.includesEscalationBehavior} ` +
        `totalTenantChars=${fp.totalChars}`,
    );

    const tenantRaw = (input.promptConfig?.systemPrompt ?? '').trim();
    const agencyRaw = globalPolicyRaw;
    const compact = compactPersonaPolicyForGeneration({
      tenantPrompt: tenantRaw,
      agencyPrompt: agencyRaw,
    });

    let base = '';
    if (compact.agencyBody.trim() && compact.tenantBody.trim()) {
      base = `${compact.agencyBody.trim()}\n\n---\n\nSubaccount bot instructions:\n${compact.tenantBody.trim()}`;
    } else if (compact.tenantBody.trim()) {
      base = compact.tenantBody.trim();
    } else if (compact.agencyBody.trim()) {
      base = compact.agencyBody.trim();
    }

    const assembled = `${base}\n\n${block}${caps}`;
    const runtimePromptCharLength = assembled.length;
    const estimatedPromptTokens = estimateApproxTokens(runtimePromptCharLength);
    if (promptFootprintDebugEnabled()) {
      this.logger.log(
        `Runtime prompt footprint: personaLengthRaw=${tenantRaw.length} agencyPolicyLengthRaw=${agencyRaw.length} ` +
          `personaCompactTruncated=${compact.tenantTruncated} agencyCompactTruncated=${compact.agencyTruncated} ` +
          `runtimePromptCharLength=${runtimePromptCharLength} estimatedPromptTokens=${estimatedPromptTokens}`,
      );
    }
    if (compact.tenantTruncated || compact.agencyTruncated) {
      const warnKey = promptCompactTruncationWarnKey(input.tenantId, input.promptConfig?.id);
      if (shouldEmitPromptCompactTruncationWarn(warnKey)) {
        this.logger.warn(
          `Prompt compacted/truncated; consider moving long business content into KB or shortening global prompt. ` +
            `tenantId=${input.tenantId} promptConfigId=${input.promptConfig?.id ?? 'n/a'} ` +
            `personaLengthRaw=${tenantRaw.length} agencyPolicyLengthRaw=${agencyRaw.length}`,
        );
      }
    }
    return `${assembled}\n\n${whatsappBlock}`;
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
      SKIP_AI_OFF_TAG: 'SKIP_AI_OFF_TAG',
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
