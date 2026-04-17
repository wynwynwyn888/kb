// Conversation Orchestration Service — orchestrates the inbound message pipeline
// Loads tenant/runtime context, applies guards, loads memory, calls AI router,
// produces structured result for downstream layers (formatter, outbound send, etc.)
// Does NOT send outbound message — that is a later layer's responsibility.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { OrchestrationGuards } from './orchestration-guards.service';
import { ConversationMemoryLoader } from './conversation-memory-loader';
import { AiRouterService } from '../ai-router/ai-router.service';
import type {
  OrchestrationInput,
  OrchestrationResult,
  GuardOutcome,
  RoutingRequest,
  MemoryEntry,
} from './dto';
import type { RoutingResponse } from './dto';
import { safeLog } from '../../lib/encryption';

@Injectable()
export class ConversationOrchestrationService {
  private readonly logger = new Logger(ConversationOrchestrationService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly guards: OrchestrationGuards,
    private readonly memoryLoader: ConversationMemoryLoader,
    private readonly aiRouter: AiRouterService,
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
        const logId = await this.persistOrchestrationLog(input, guardOutcome, null);
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

      // Step 3: Build AI routing request
      const systemPrompt = this.buildSystemPrompt(input);
      const routingRequest = this.buildRoutingRequest(input, memory, systemPrompt);

      // Step 4: Call AI router placeholder
      const routing = await this.aiRouter.route(routingRequest);

      // Step 5: Persist orchestration log
      const logId = await this.persistOrchestrationLog(input, guardOutcome, routing);

      this.logger.log(
        `Orchestration completed: conversationId=${conversationId}, model=${routing.recommendedModel}, mode=${routing.responseMode}`,
      );

      return {
        success: true,
        outcome: 'PROCEED',
        conversationId,
        webhookEventId,
        guards: guardOutcome,
        routing,
        logId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `Orchestration error: conversationId=${conversationId}, error=${message}`,
      );
      // Attempt to log the error outcome
      try {
        const logId = await this.persistOrchestrationLog(input, { final: 'ERROR', guards: [] }, null);
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
   * Called before guards run.
   */
  async loadTenantContext(tenantId: string): Promise<OrchestrationInput['tenant'] | null> {
    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('id, name, bot_enabled, handover_paused, ghl_location_id')
      .eq('id', tenantId)
      .single();

    if (!tenant) return null;

    return {
      id: tenant.id,
      name: tenant.name,
      botEnabled: tenant.bot_enabled,
      handoverPaused: tenant.handover_paused,
      ghlLocationId: tenant.ghl_location_id,
    };
  }

  /**
   * Load active prompt config for a tenant.
   */
  async loadPromptConfig(
    tenantId: string,
  ): Promise<OrchestrationInput['promptConfig']> {
    const { data: config } = await this.supabase
      .from('tenant_prompt_configs')
      .select('id, system_prompt, temperature, model_override, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (!config) return null;

    return {
      id: config.id,
      systemPrompt: config.system_prompt,
      temperature: config.temperature,
      modelOverride: config.model_override || undefined,
      isActive: config.is_active,
    };
  }

  /**
   * Load agency-level system policy (if any) for a tenant.
   */
  async loadAgencyPolicy(
    tenantId: string,
  ): Promise<OrchestrationInput['agencyPolicy']> {
    // Get agencyId from tenant
    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .single();

    if (!tenant) return null;

    const { data: policies } = await this.supabase
      .from('agency_system_policies')
      .select('id, system_prompt, default_model, fallback_model')
      .eq('agency_id', tenant.agency_id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!policies || policies.length === 0) return null;

    const policy = policies[0]!;
    return {
      id: policy.id,
      systemPrompt: policy.system_prompt,
      defaultModel: policy.default_model || undefined,
      fallbackModel: policy.fallback_model || undefined,
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

  private buildSystemPrompt(input: OrchestrationInput): string {
    // Priority: tenant prompt config > agency system policy > fallback
    const tenantPrompt = input.promptConfig?.systemPrompt;
    const agencyPrompt = input.agencyPolicy?.systemPrompt;

    if (tenantPrompt) return tenantPrompt;
    if (agencyPrompt) return agencyPrompt;

    return 'You are a helpful AI assistant.';
  }

  private buildRoutingRequest(
    input: OrchestrationInput,
    memory: { entries: MemoryEntry[] },
    systemPrompt: string,
  ): RoutingRequest {
    const incomingMessage = input.incomingMessage.messageContent;
    const incomingMessageType = input.incomingMessage.messageType;

    // Simple booking intent detection heuristic
    const bookingKeywords = ['book', 'schedule', 'appointment', 'reservation', 'when', 'available'];
    const bookingIntentDetected = bookingKeywords.some(k =>
      incomingMessage.toLowerCase().includes(k),
    );

    // Estimate token count (rough: ~4 chars per token)
    const estimatedInputTokens = Math.ceil(
      (incomingMessage.length + systemPrompt.length) / 4,
    );

    return {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      incomingMessage,
      incomingMessageType,
      systemPrompt,
      memory: memory.entries,
      channel: input.conversation?.channel ?? 'WHATSAPP',
      handoverRecommended: false,
      bookingIntentDetected,
      estimatedInputTokens,
    };
  }

  private async persistOrchestrationLog(
    input: OrchestrationInput,
    guardOutcome: GuardOutcome,
    routing: RoutingResponse | null,
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

    const logData = {
      tenant_id: input.tenantId,
      conversation_id: input.conversationId,
      webhook_event_id: input.webhookEventId ?? null,
      outcome,
      guard_reason: guardReason,
      model_chosen: routing?.recommendedModel ?? null,
      response_mode: routing?.responseMode ?? null,
      draft_reply: routing?.draftReply ?? null,
      handover_recommended: routing?.handoverRecommended ?? false,
      confidence: routing?.confidence ?? null,
      metadata: {},
    };

    const { data, error } = await this.supabase
      .from('orchestration_logs')
      .insert(logData)
      .select('id')
      .single();

    if (error) {
      this.logger.error(
        `Failed to persist orchestration log: ${safeLog({ error: error.message })}`,
      );
      return undefined;
    }

    return data.id;
  }
}
