import { ConfigService } from '@nestjs/config';
import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import {
  BOT_RESET_CLEARED_POLICY_KEYS,
  mergePolicyIntoConversationMetadata,
  parseAisbpPolicyState,
  policyStateAfterBotReset,
} from '../conversation-policy/conversation-policy-state';
import { stripAisbpBookingFromMetadata } from '../booking-flow/conversation-booking-state';
import { mergeConversationMetadataForPersist } from '../../lib/conversation-metadata-merge';
import {
  buildChatResetContactWhitelist,
  evaluateAllowChatResetCommands,
  isContactAllowedForChatReset,
  type ChatResetAllowDeniedReason,
} from '../../lib/chat-reset-tenant-policy';
import type { ReplyDecision } from '../reply-planning/dto';
import { ConversationsService } from './conversations.service';
import { FollowUpEngineService } from '../follow-up-engine/follow-up-engine.service';

export interface ChatResetEligibilitySnapshot {
  allowed: boolean;
  deniedReason?: ChatResetAllowDeniedReason;
  allowEnvValue: string | undefined;
  tenantSettingValue: unknown;
  whitelistConfigured: boolean;
  contactMatchedWhitelist: boolean;
}

function readEnvAllowChatResetCommands(config: ConfigService): string | undefined {
  const v = config.get<string>('ALLOW_CHAT_RESET_COMMANDS') ?? process.env['ALLOW_CHAT_RESET_COMMANDS'];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function readEnvChatResetAllowedContacts(config: ConfigService): string | undefined {
  const v = config.get<string>('CHAT_RESET_ALLOWED_CONTACTS') ?? process.env['CHAT_RESET_ALLOWED_CONTACTS'];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

const RESET_CONFIRMATION_TEXT =
  'Started a fresh chat for this conversation.\n\nYou can test from here.';

export type BotResetSource = 'chat_command' | 'dashboard';

@Injectable()
export class ConversationResetService implements OnModuleInit {
  private readonly logger = new Logger(ConversationResetService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly config: ConfigService,
    private readonly conversationsService: ConversationsService,
    @Inject(forwardRef(() => FollowUpEngineService))
    private readonly followUpEngine: FollowUpEngineService,
  ) {}

  onModuleInit(): void {
    const rawContacts = readEnvChatResetAllowedContacts(this.config);
    this.logger.log(
      `chatResetRuntimeConfig: ${JSON.stringify({
        NODE_ENV: this.config.get<string>('NODE_ENV', 'development'),
        ALLOW_CHAT_RESET_COMMANDS: readEnvAllowChatResetCommands(this.config) ?? null,
        CHAT_RESET_ALLOWED_CONTACTS_configured: Boolean(rawContacts),
      })}`,
    );
  }

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

  /**
   * Policy + optional contact whitelist for inbound `/new`-style commands.
   * Uses `ALLOW_CHAT_RESET_COMMANDS` / `CHAT_RESET_ALLOWED_CONTACTS` from ConfigService with `process.env` fallback
   * so workers always see container env even if Nest config hydration differs.
   */
  async evaluateChatResetEligibility(
    tenantId: string,
    ghlContactId: string | null | undefined,
  ): Promise<ChatResetEligibilitySnapshot> {
    const { data } = await this.supabase.from('tenants').select('settings').eq('id', tenantId).single();
    const settings = (data?.settings as Record<string, unknown> | undefined) ?? undefined;
    const envAllowRaw = readEnvAllowChatResetCommands(this.config);
    const envContactsRaw = readEnvChatResetAllowedContacts(this.config);

    const policy = evaluateAllowChatResetCommands({
      nodeEnv: this.config.get<string>('NODE_ENV', 'development'),
      envAllow: envAllowRaw,
      tenantSettings: settings ?? null,
    });

    const whitelist = buildChatResetContactWhitelist({
      envContacts: envContactsRaw,
      tenantSettings: settings ?? null,
    });
    const whitelistConfigured = whitelist.length > 0;
    const contactMatchedWhitelist = isContactAllowedForChatReset(ghlContactId ?? null, whitelist);

    let allowed = policy.allowed;
    let deniedReason: ChatResetAllowDeniedReason | undefined = policy.deniedReason;

    if (allowed && !contactMatchedWhitelist) {
      allowed = false;
      deniedReason = 'whitelist_blocked';
    }

    return {
      allowed,
      deniedReason,
      allowEnvValue: envAllowRaw,
      tenantSettingValue: settings?.['allowChatResetCommands'],
      whitelistConfigured,
      contactMatchedWhitelist,
    };
  }

  async isChatResetAllowedForContact(tenantId: string, ghlContactId: string | null | undefined): Promise<boolean> {
    const snap = await this.evaluateChatResetEligibility(tenantId, ghlContactId);
    return snap.allowed;
  }

  /**
   * Clears bot policy state, sets memoryResetAt / resetVersion, optionally enqueues confirmation send.
   */
  async performBotStateReset(params: {
    conversationId: string;
    tenantId: string;
    source: BotResetSource;
    resetCommand?: string;
    /** Prefer the actual inbound command row timestamp so memory reset ordering matches persisted chat history. */
    resetAtIso?: string;
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
    const resetAt = params.resetAtIso?.trim() || new Date().toISOString();
    const nextPolicy = policyStateAfterBotReset(prevPolicy, resetAt);
    let merged = mergePolicyIntoConversationMetadata(prevMeta, nextPolicy);
    merged = stripAisbpBookingFromMetadata(merged);
    merged = mergeConversationMetadataForPersist(prevMeta, merged);

    const { error: uErr } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: resetAt })
      .eq('id', conversationId);
    if (uErr) {
      throw new Error(`Failed to persist reset metadata: ${formatPostgrestError(uErr)}`);
    }

    try {
      await this.followUpEngine.cancelPendingJobsForBotReset({ tenantId, conversationId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `botResetFollowUpCancelFailed ${JSON.stringify({ conversationId, tenantId, message: msg })}`,
      );
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

  /**
   * Allowed chat reset commands and dashboard reset-state clear conversation handover so QA can continue.
   */
  async clearHandoverAfterAllowedReset(conversationId: string, tenantId: string): Promise<void> {
    const result = await this.conversationsService.resolveActiveHandoversForAllowedChatReset(
      conversationId,
      tenantId,
    );
    this.logger.log(
      `chatResetHandoverCleared: ${JSON.stringify({
        conversationId,
        tenantId,
        activeHandoverFound: result.activeHandoverFound,
        handoverEventsResolved: result.handoverEventsResolved,
        handoverPausedBefore: result.handoverPausedBefore,
        handoverPausedAfter: result.handoverPausedAfter,
      })}`,
    );
  }
}
