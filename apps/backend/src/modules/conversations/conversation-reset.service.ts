import { ConfigService } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import {
  BOT_RESET_CLEARED_POLICY_KEYS,
  mergePolicyIntoConversationMetadata,
  parseAisbpPolicyState,
  policyStateAfterBotReset,
} from '../conversation-policy/conversation-policy-state';
import {
  buildChatResetContactWhitelist,
  isContactAllowedForChatReset,
  resolveAllowChatResetCommands,
} from '../../lib/chat-reset-tenant-policy';
import type { ReplyDecision } from '../reply-planning/dto';

const RESET_CONFIRMATION_TEXT =
  'Started a fresh chat for this conversation.\n\nYou can test from here.';

export type BotResetSource = 'chat_command' | 'dashboard';

@Injectable()
export class ConversationResetService {
  private readonly logger = new Logger(ConversationResetService.name);
  private readonly supabase = getSupabaseService();

  constructor(private readonly config: ConfigService) {}

  buildConfirmationReplyPlan(): ReplyDecision {
    return {
      planStatus: 'PLANNED',
      responseMode: 'standard',
      handoverRecommended: false,
      confidence: 1,
      rationale: 'chat_reset_confirmation',
      bubbles: [{ index: 0, text: RESET_CONFIRMATION_TEXT }],
      suggestedActions: [],
      draftProvenance: 'policy_reply',
    };
  }

  async isChatResetAllowedForContact(tenantId: string, ghlContactId: string | null | undefined): Promise<boolean> {
    const { data } = await this.supabase.from('tenants').select('settings').eq('id', tenantId).single();
    const settings = (data?.settings as Record<string, unknown> | undefined) ?? undefined;
    const allow = resolveAllowChatResetCommands({
      nodeEnv: this.config.get<string>('NODE_ENV', 'development'),
      envAllow: this.config.get<string>('ALLOW_CHAT_RESET_COMMANDS'),
      tenantSettings: settings ?? null,
    });
    if (!allow) return false;
    const whitelist = buildChatResetContactWhitelist({
      envContacts: this.config.get<string>('CHAT_RESET_ALLOWED_CONTACTS'),
      tenantSettings: settings ?? null,
    });
    return isContactAllowedForChatReset(ghlContactId ?? null, whitelist);
  }

  /**
   * Clears bot policy state, sets memoryResetAt / resetVersion, optionally enqueues confirmation send.
   */
  async performBotStateReset(params: {
    conversationId: string;
    tenantId: string;
    source: BotResetSource;
    resetCommand?: string;
  }): Promise<{
    memoryResetAt: string;
    resetVersion: number;
    clearedKeys: readonly string[];
  }> {
    const { conversationId, tenantId, source, resetCommand } = params;

    const { data: conv, error: cErr } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .single();
    if (cErr || !conv) {
      throw new Error(`Conversation not found: ${formatPostgrestError(cErr ?? 'missing')}`);
    }

    const prevMeta =
      conv.metadata && typeof conv.metadata === 'object' && !Array.isArray(conv.metadata)
        ? { ...(conv.metadata as Record<string, unknown>) }
        : {};
    const prevPolicy = parseAisbpPolicyState(prevMeta);
    const resetAt = new Date().toISOString();
    const nextPolicy = policyStateAfterBotReset(prevPolicy, resetAt);
    const merged = mergePolicyIntoConversationMetadata(prevMeta, nextPolicy);

    const { error: uErr } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: resetAt })
      .eq('id', conversationId);
    if (uErr) {
      throw new Error(`Failed to persist reset metadata: ${formatPostgrestError(uErr)}`);
    }

    this.logger.log(
      `botStateReset: conversationId=${conversationId} tenantId=${tenantId} resetSource=${source} ` +
        `resetCommand=${resetCommand ?? 'n/a'} resetAt=${resetAt} resetVersion=${nextPolicy.resetVersion ?? 0} ` +
        `memoryResetAt=${nextPolicy.memoryResetAt ?? resetAt} clearedKeys=${JSON.stringify([...BOT_RESET_CLEARED_POLICY_KEYS])}`,
    );

    return {
      memoryResetAt: nextPolicy.memoryResetAt ?? resetAt,
      resetVersion: nextPolicy.resetVersion ?? 0,
      clearedKeys: BOT_RESET_CLEARED_POLICY_KEYS,
    };
  }
}
