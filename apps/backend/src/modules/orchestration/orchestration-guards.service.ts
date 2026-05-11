// Runtime guards — explicit guard checks before AI step
// Each guard is a focused, testable function.
// Guards are run in order of priority.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type {
  OrchestrationInput,
  GuardResult,
  GuardOutcome,
  GuardDecision,
} from './dto';

@Injectable()
export class OrchestrationGuards {
  private readonly logger = new Logger(OrchestrationGuards.name);
  private readonly supabase = getSupabaseService();

  /**
   * Run all guards against the orchestration input.
   * Returns aggregated outcome with individual guard results.
   * Short-circuits on first non-PROCEED decision (guards are cascade priority).
   */
  async runGuards(input: OrchestrationInput): Promise<GuardOutcome> {
    const guards: GuardResult[] = [];

    // Guard 1: Bot enabled
    const botGuard = await this.checkBotEnabled(input);
    guards.push(botGuard);
    if (botGuard.decision !== 'PROCEED') {
      return this.buildOutcome(botGuard.decision, guards);
    }

    // Guard 2: GHL integration connected
    const ghlGuard = await this.checkGhlConnected(input);
    guards.push(ghlGuard);
    if (ghlGuard.decision !== 'PROCEED') {
      return this.buildOutcome(ghlGuard.decision, guards);
    }

    // Guard 3: Conversation automation paused (GHL conversation status)
    const automationGuard = await this.checkConversationAutomationPaused(input);
    guards.push(automationGuard);
    if (automationGuard.decision !== 'PROCEED') {
      return this.buildOutcome(automationGuard.decision, guards);
    }

    // Guard 4: Handover paused
    const handoverGuard = await this.checkHandoverPaused(input);
    guards.push(handoverGuard);
    if (handoverGuard.decision !== 'PROCEED') {
      return this.buildOutcome(handoverGuard.decision, guards);
    }

    // Guard 5: Quota available
    const quotaGuard = await this.checkQuotaAvailable(input);
    guards.push(quotaGuard);
    if (quotaGuard.decision !== 'PROCEED') {
      return this.buildOutcome(quotaGuard.decision, guards);
    }

    // Guard 6: Supported message type
    const typeGuard = await this.checkMessageType(input);
    guards.push(typeGuard);
    if (typeGuard.decision !== 'PROCEED') {
      return this.buildOutcome(typeGuard.decision, guards);
    }

    // Guard 7: Supported channel
    const channelGuard = await this.checkChannel(input);
    guards.push(channelGuard);
    if (channelGuard.decision !== 'PROCEED') {
      return this.buildOutcome(channelGuard.decision, guards);
    }

    return this.buildOutcome('PROCEED', guards);
  }

  private async checkBotEnabled(input: OrchestrationInput): Promise<GuardResult> {
    if (!input.tenant) {
      return { decision: 'ERROR', guardName: 'bot_enabled', reason: 'Tenant context not loaded' };
    }
    if (!input.tenant.botEnabled) {
      this.logger.debug(`Guard SKIP_BOT_DISABLED for tenant=${input.tenantId}`);
      return {
        decision: 'SKIP_BOT_DISABLED',
        guardName: 'bot_enabled',
        reason: 'Tenant bot is disabled',
      };
    }
    return { decision: 'PROCEED', guardName: 'bot_enabled' };
  }

  private async checkGhlConnected(input: OrchestrationInput): Promise<GuardResult> {
    if (!input.tenant) {
      return { decision: 'ERROR', guardName: 'ghl_connected', reason: 'Tenant context not loaded' };
    }

    const { data: conn } = await this.supabase
      .from('tenant_ghl_connections')
      .select('status')
      .eq('tenant_id', input.tenantId)
      .single();

    if (!conn || conn.status !== 'CONNECTED') {
      this.logger.debug(`Guard SKIP_GHL_DISCONNECTED for tenant=${input.tenantId}`);
      return {
        decision: 'SKIP_GHL_DISCONNECTED',
        guardName: 'ghl_connected',
        reason: 'GHL integration is not connected',
      };
    }
    return { decision: 'PROCEED', guardName: 'ghl_connected' };
  }

  private async checkConversationAutomationPaused(
    input: OrchestrationInput,
  ): Promise<GuardResult> {
    const raw = input.conversation?.status;
    const status = typeof raw === 'string' ? raw.toUpperCase() : '';
    if (status === 'PAUSED') {
      this.logger.debug(
        `Guard SKIP_AUTOMATION_PAUSED for conversation=${input.conversationId ?? 'n/a'}`,
      );
      return {
        decision: 'SKIP_AUTOMATION_PAUSED',
        guardName: 'automation_paused',
        reason: 'Conversation automation is PAUSED',
      };
    }
    return { decision: 'PROCEED', guardName: 'automation_paused' };
  }

  private async checkHandoverPaused(input: OrchestrationInput): Promise<GuardResult> {
    if (!input.tenant) {
      return { decision: 'ERROR', guardName: 'handover_paused', reason: 'Tenant context not loaded' };
    }
    if (input.tenant.handoverPaused) {
      this.logger.debug(`Guard SKIP_HANDOVER_ACTIVE for tenant=${input.tenantId}`);
      return {
        decision: 'SKIP_HANDOVER_ACTIVE',
        guardName: 'handover_paused',
        reason: 'Handover is paused for this tenant',
      };
    }

    // Also check active handover event on the conversation
    if (input.conversationId) {
      const { data: activeHandover } = await this.supabase
        .from('handover_events')
        .select('id')
        .eq('conversation_id', input.conversationId)
        .eq('status', 'ACTIVE')
        .single();

      if (activeHandover) {
        this.logger.debug(`Guard SKIP_HANDOVER_ACTIVE for conversation=${input.conversationId}`);
        return {
          decision: 'SKIP_HANDOVER_ACTIVE',
          guardName: 'handover_paused',
          reason: 'Active handover event exists for this conversation',
        };
      }
    }
    return { decision: 'PROCEED', guardName: 'handover_paused' };
  }

  private async checkQuotaAvailable(input: OrchestrationInput): Promise<GuardResult> {
    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('total_quota, used_quota, allow_negative_credits, negative_credit_limit')
      .eq('tenant_id', input.tenantId)
      .single();

    if (!wallet) {
      // No wallet means no quota tracking — allow by default
      return { decision: 'PROCEED', guardName: 'quota_available' };
    }

    const balance = wallet.total_quota - wallet.used_quota;
    const allowNegativeCredits = Boolean(wallet.allow_negative_credits);
    const negativeCreditLimit =
      typeof wallet.negative_credit_limit === 'number' ? wallet.negative_credit_limit : 0;

    const blocked = allowNegativeCredits
      ? balance <= negativeCreditLimit
      : balance <= 0;

    if (blocked) {
      this.logger.warn(
        `creditBlocked ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId ?? null,
          balance,
          allowNegativeCredits,
          negativeCreditLimit,
        })}`,
      );
      return {
        decision: 'SKIP_QUOTA_EXHAUSTED',
        guardName: 'quota_available',
        reason: allowNegativeCredits
          ? `Over negative credit limit (balance=${balance}, limit=${negativeCreditLimit})`
          : `No remaining credits (balance=${balance})`,
      };
    }
    return { decision: 'PROCEED', guardName: 'quota_available' };
  }

  private async checkMessageType(
    input: OrchestrationInput,
  ): Promise<GuardResult> {
    const supported = ['text'];
    const msgType = input.incomingMessage.messageType;
    if (!supported.includes(msgType)) {
      this.logger.debug(
        `Guard SKIP_UNSUPPORTED_MESSAGE_TYPE for type=${msgType}`,
      );
      return {
        decision: 'SKIP_UNSUPPORTED_MESSAGE_TYPE',
        guardName: 'message_type',
        reason: `Message type '${msgType}' is not yet supported`,
      };
    }
    return { decision: 'PROCEED', guardName: 'message_type' };
  }

  private async checkChannel(input: OrchestrationInput): Promise<GuardResult> {
    // Whitelist of channels we support at the orchestration layer
    // Others (sms, chat, email) may be supported later by different handlers
    const supported = ['WHATSAPP', 'whatsapp'];
    const channel = input.conversation?.channel?.toUpperCase();
    if (!channel || !supported.includes(channel)) {
      this.logger.debug(
        `Guard SKIP_UNSUPPORTED_CHANNEL for channel=${channel ?? 'null'}`,
      );
      return {
        decision: 'SKIP_UNSUPPORTED_CHANNEL',
        guardName: 'channel',
        reason: `Channel '${channel ?? 'null'}' is not yet supported`,
      };
    }
    return { decision: 'PROCEED', guardName: 'channel' };
  }

  private buildOutcome(final: GuardDecision, guards: GuardResult[]): GuardOutcome {
    return { final, guards };
  }
}
