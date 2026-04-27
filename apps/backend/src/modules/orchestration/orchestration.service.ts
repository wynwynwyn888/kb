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
  type AisbpPolicyStateV1,
} from '../conversation-policy/conversation-policy-state';
import { resolveShortSelection } from '../conversation-policy/option-resolver';
import { stripInternalGuidanceFromChunks } from '../../lib/kb-internal-guidance';
import { interpretRetrievalChunks } from '../../lib/kb-chunk-interpretation';
import { resolveOperatingHoursConflictsAmongChunks } from '../../lib/kb-operating-hours-conflict';
import { prepareCustomerFacingMenuKb, shouldCurateMenuKbContext } from '../../lib/menu-kb-curator';

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
      const memory = await this.memoryLoader.loadMemory(conversationId);

      const latestMsg = (input.incomingMessage.messageContent ?? '').trim();
      const latestIntent = classifyConversationIntent(latestMsg);

      const policyStatePre = this.conversationPolicy.parseState(input.conversation?.metadata);
      let retrieveQuery = latestMsg;
      let menuKbAnchor: string | undefined;
      if (latestIntent === 'SHORT_SELECTION' && policyStatePre.awaiting === 'menu_category_selection') {
        const sel = resolveShortSelection(latestMsg, policyStatePre, memory.entries);
        if (sel) {
          menuKbAnchor = sel.selectedText;
          retrieveQuery = `${sel.selectedText} menu food dishes`;
        }
      }

      // Step 3: Retrieve KB + intent-aware filter (query may expand for menu category selection)
      const { chunks: kbAfterRetrieve, meta: retrievalMeta } = await this.retrieveKbContext(
        input,
        conversationId,
        latestIntent,
        { retrieveQuery, menuKbAnchor },
      );

      const policyState = policyStatePre;
      let kbInterpreted = interpretRetrievalChunks(kbAfterRetrieve);
      kbInterpreted = resolveOperatingHoursConflictsAmongChunks(kbInterpreted, msg =>
        this.logger.warn(msg),
      );
      let kbRanked = stripInternalGuidanceFromChunks(kbInterpreted);
      if (shouldCurateMenuKbContext({ latestIntent, menuKbAnchor })) {
        kbRanked = prepareCustomerFacingMenuKb(kbRanked, {
          latestUserMessage: latestMsg,
          latestIntent,
          menuAnchorLabel: menuKbAnchor,
        });
      }

      const policyOutcome = this.conversationPolicy.evaluate({
        intent: latestIntent,
        incomingRaw: latestMsg,
        memory: memory.entries,
        policyState,
        kbChunksRanked: kbRanked,
        tenantDisplayName: input.tenant?.name,
      });
      const kbChunks = policyOutcome.kbChunks;

      // Step 4: Build AI routing request (includes KB context)
      const systemPrompt = this.buildSystemPrompt(input);
      const routingRequest = this.buildRoutingRequest(
        input,
        memory,
        systemPrompt,
        kbChunks,
      );

      // Step 5: Call AI router placeholder
      const routing = await this.aiRouter.route(routingRequest);

      // Step 6: Build structured reply plan
      const replyPlan = await this.replyPlanner.planReply({
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
        },
      });

      await this.persistConversationPolicyMetadata(
        conversationId,
        (input.conversation?.metadata as Record<string, unknown> | undefined) ?? {},
        policyOutcome.nextPolicyState,
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
          (input.recentInboundBatch?.length
            ? `, inboundBatchCount=${input.recentInboundBatch.length}`
            : ''),
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
    const { data: rows, error } = await this.supabase
      .from('tenant_prompt_configs')
      .select('id, system_prompt, temperature, model_override, max_tokens, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      this.logger.warn(`loadPromptConfig: ${error.message}`);
      return null;
    }
    const config = rows?.[0];
    if (!config) return null;

    return {
      id: config.id,
      systemPrompt: config.system_prompt,
      temperature: config.temperature,
      modelOverride: config.model_override || undefined,
      maxTokens: (config as { max_tokens?: number | null }).max_tokens ?? null,
      isActive: config.is_active,
    };
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
    opts?: { retrieveQuery?: string; menuKbAnchor?: string },
  ): Promise<{ chunks: RetrievalChunk[]; meta: RetrievalMeta | null }> {
    try {
      const retrieveQuery =
        (opts?.retrieveQuery ?? input.incomingMessage.messageContent ?? '').trim() ||
        (input.incomingMessage.messageContent ?? '').trim();

      const result = await this.kbService.retrieve({
        tenantId: input.tenantId,
        conversationId,
        query: retrieveQuery,
        topK: 5,
      });

      const { chunks: filteredChunks, rejections } = filterKbChunksForPolicy(
        latestIntent,
        (input.incomingMessage.messageContent ?? '').trim(),
        result.chunks,
        { menuKbAnchor: opts?.menuKbAnchor },
      );
      for (const r of rejections) {
        this.logger.log(
          `KB rejected: reason=${r.reason}, latestMessage_class=${r.queryClass}, kbTitle=${r.kbTitleShort}`,
        );
      }

      const meta: RetrievalMeta = {
        chunksReturned: filteredChunks.length,
        chunksConsidered: result.totalConsidered,
        retrievalMode: result.retrievalMode,
        topScore: filteredChunks[0]?.relevanceScore ?? result.chunks[0]?.relevanceScore ?? null,
      };

      return { chunks: filteredChunks, meta };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`KB retrieval failed for conversation=${conversationId}: ${msg}`);
      return { chunks: [], meta: null };
    }
  }

  private buildSystemPrompt(input: OrchestrationInput): string {
    const tenantPrompt = input.promptConfig?.systemPrompt?.trim();
    const agencyPrompt = input.agencyPolicy?.systemPrompt?.trim();

    if (tenantPrompt && agencyPrompt) {
      return `${agencyPrompt}\n\n---\n\nSubaccount bot instructions:\n${tenantPrompt}`;
    }
    if (tenantPrompt) return tenantPrompt;
    if (agencyPrompt) return agencyPrompt;

    return 'You are a helpful AI assistant.';
  }

  private buildRoutingRequest(
    input: OrchestrationInput,
    memory: { entries: MemoryEntry[] },
    systemPrompt: string,
    kbChunks: RetrievalChunk[],
  ): RoutingRequest {
    const incomingMessage = input.incomingMessage.messageContent;
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
