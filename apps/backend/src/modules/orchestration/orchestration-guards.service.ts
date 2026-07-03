// Runtime guards — explicit guard checks before AI step
// Each guard is a focused, testable function.
// Guards are run in order of priority.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type {
  OrchestrationInput,
  GuardResult,
  GuardOutcome,
  GuardDecision,
} from './dto';
import { ghlBodyIndicatesImagePlaceholder } from '../webhooks/ghl-inbound-image-media';
import { GhlService } from '../ghl/ghl.service';

@Injectable()
export class OrchestrationGuards {
  private readonly logger = new Logger(OrchestrationGuards.name);
  private readonly supabase = getSupabaseService();

  constructor(@Optional() private readonly ghlService?: GhlService) {}

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

    // Guard 8: AI off tag — skip reply if contact has "AI off" tag
    const aiOffGuard = await this.checkAiOffTag(input);
    guards.push(aiOffGuard);
    if (aiOffGuard.decision !== 'PROCEED') {
      return this.buildOutcome(aiOffGuard.decision, guards);
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

    let connQuery = this.supabase
      .from('tenant_ghl_connections')
      .select('status')
      .eq('tenant_id', input.tenantId);
    const locationId = input.tenant.ghlLocationId?.trim();
    if (locationId) {
      connQuery = connQuery.eq('ghl_location_id', locationId);
    }
    const { data: conn } = await connQuery.maybeSingle();

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

    const conversationStatus =
      typeof input.conversation?.status === 'string'
        ? input.conversation.status.trim().toUpperCase()
        : '';
    if (conversationStatus === 'HANDOVER') {
      this.logger.debug(
        `Guard SKIP_HANDOVER_ACTIVE for conversation=${input.conversationId} status=HANDOVER`,
      );
      return {
        decision: 'SKIP_HANDOVER_ACTIVE',
        guardName: 'handover_paused',
        reason: 'Conversation status is HANDOVER',
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
    const { data: tenantRow } = await this.supabase
      .from('tenants')
      .select('credits_unlimited')
      .eq('id', input.tenantId)
      .maybeSingle();
    if (Boolean((tenantRow as { credits_unlimited?: boolean } | null)?.credits_unlimited)) {
      return { decision: 'PROCEED', guardName: 'quota_available' };
    }

    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('total_quota, used_quota, allow_negative_credits, negative_credit_limit')
      .eq('tenant_id', input.tenantId)
      .maybeSingle();

    if (!wallet) {
      // Align with QuotasService.checkQuota: no wallet row means credits are not tracked yet.
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
    const supported = ['text', 'image'];
    const msgType = input.incomingMessage.messageType;
    const body = input.incomingMessage.messageContent ?? '';
    if (
      !supported.includes(msgType) &&
      !(msgType === 'unknown' && ghlBodyIndicatesImagePlaceholder(body))
    ) {
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
    // Reply on any conversation channel that has a stored label — outbound routing picks the GHL send type.
    const channel = input.conversation?.channel?.trim();
    if (!channel) {
      this.logger.debug(`Guard SKIP_UNSUPPORTED_CHANNEL for channel=null`);
      return {
        decision: 'SKIP_UNSUPPORTED_CHANNEL',
        guardName: 'channel',
        reason: `Channel 'null' is not yet supported`,
      };
    }
    return { decision: 'PROCEED', guardName: 'channel' };
  }

  /**
   * Guard 8: Skip AI reply if the GHL contact has an "AI off" tag (case-insensitive).
   *
   * Checks conversation metadata ai_status first (synced copy from TagAdded/Removed webhooks).
   * Falls back to GHL getContact API when metadata is missing and updates metadata on success.
   * Fails closed on any error (no reply).
   */
  private async checkAiOffTag(input: OrchestrationInput): Promise<GuardResult> {
    const contactId = input.conversation?.contactId?.trim();
    if (!contactId) {
      return { decision: 'PROCEED', guardName: 'ai_off_tag', reason: 'no_contact_id' };
    }

    const conversationId = input.conversationId;
    const metadata = (input.conversation?.metadata ?? {}) as Record<string, unknown>;
    const aiStatus = typeof metadata['ai_status'] === 'string' ? metadata['ai_status'].trim().toLowerCase() : null;

    // 1. Metadata has explicit status
    // "off" is authoritative — no TTL, always block.
    // "active" is cached — re-verify via GHL if older than 5 minutes to prevent
    // stale trust when a TagRemoved→TagAdded transition's webhook was missed.
    const AI_STATUS_TTL_MS = 5 * 60 * 1000;
    const updatedAtRaw = metadata['ai_status_updated_at'];
    const updatedAt = typeof updatedAtRaw === 'string' ? new Date(updatedAtRaw).getTime() : 0;
    const activeIsFresh = aiStatus === 'active' && updatedAt > 0 && (Date.now() - updatedAt) < AI_STATUS_TTL_MS;

    if (aiStatus === 'off') {
      return { decision: 'SKIP_AI_OFF_TAG', guardName: 'ai_off_tag', reason: 'ai_status=off (metadata)' };
    }
    if (activeIsFresh) {
      return { decision: 'PROCEED', guardName: 'ai_off_tag', reason: 'ai_status=active (metadata, fresh)' };
    }
    // "active" but stale, or missing — fall through to GHL lookup

    // 2. Metadata missing — fallback to GHL API
    try {
      if (!this.ghlService) {
        return { decision: 'PROCEED', guardName: 'ai_off_tag', reason: 'no_ghl_service' };
      }

      const { client } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(
        input.tenantId,
      );
      const result = await client.getContact(contactId);
      if (!result.success || !result.contact) {
        // API failure — fail closed (do not reply)
        this.logger.warn(
          `ai_off_tag_check_failed_blocking: tenantId=${input.tenantId} contactId=${contactId} error=${result.error || 'no contact'}`,
        );
        return {
          decision: 'SKIP_AI_OFF_TAG',
          guardName: 'ai_off_tag',
          reason: `GHL contact lookup failed: ${result.error || 'no contact returned'}`,
        };
      }

      const tags: unknown = result.contact['tags'];
      const tagList: string[] = Array.isArray(tags)
        ? tags.map((t: unknown) => (typeof t === 'string' ? t : (t as any)?.name ?? ''))
        : [];

      const hasAiOff = tagList.some((t) => t.trim().toLowerCase() === 'ai off');

      // Update metadata so future checks hit the fast path
      const newStatus = hasAiOff ? 'off' : 'active';
      await this.updateConversationAiStatus(input.tenantId, input.conversationId, metadata, newStatus);

      if (hasAiOff) {
        this.logger.log(
          `ai_off_tag_present: tenantId=${input.tenantId} contactId=${contactId}`,
        );
        return {
          decision: 'SKIP_AI_OFF_TAG',
          guardName: 'ai_off_tag',
          reason: 'Contact has AI off tag',
        };
      }

      return { decision: 'PROCEED', guardName: 'ai_off_tag' };
    } catch (err) {
      // GHL API failure — fail closed (do not reply) to be safe
      this.logger.warn(
        `ai_off_tag_check_failed_blocking: tenantId=${input.tenantId} contactId=${contactId} error=${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        decision: 'SKIP_AI_OFF_TAG',
        guardName: 'ai_off_tag',
        reason: `Tag lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  /**
   * Persist ai_status to conversation metadata.
   * Non-critical — best-effort, errors are logged but not thrown.
   */
  private async updateConversationAiStatus(
    tenantId: string,
    conversationId: string | undefined,
    currentMetadata: Record<string, unknown>,
    status: string,
  ): Promise<void> {
    if (!conversationId) return;
    try {
      // Re-read fresh metadata to avoid overwriting concurrent updates
      const { data: conv } = await this.supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .maybeSingle();
      const fresh = (conv?.metadata as Record<string, unknown>) ?? currentMetadata;
      fresh['ai_status'] = status;
      fresh['ai_status_updated_at'] = new Date().toISOString();
      await this.supabase
        .from('conversations')
        .update({ metadata: fresh, updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    } catch (err) {
      this.logger.warn(
        `ai_off_update_metadata_failed: tenantId=${tenantId} conversationId=${conversationId} status=${status} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private buildOutcome(final: GuardDecision, guards: GuardResult[]): GuardOutcome {
    return { final, guards };
  }
}
