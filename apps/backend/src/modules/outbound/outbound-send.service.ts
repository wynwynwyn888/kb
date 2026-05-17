// Outbound Send Service — sends reply bubbles through GHL and tracks results.
// Does NOT make routing/AI decisions — only executes the send plan.
// Expects `ReplyDecision.bubbles` as produced by orchestration (ReplyPlannerService formatting
// is already applied). Outbound GHL send type is chosen from conversation metadata /
// `conversations.channel` (see `ghl-channel-routing` + @aisbp/ghl-client CHANNEL_MAP).

import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { createGhlClient } from '@aisbp/ghl-client';
import { sanitizeOutboundCustomerText } from '../../lib/outbound-customer-text';
import { maybeCoalesceOutboundBubbles } from '../../lib/outbound-coalesce';
import { newlineDebugMetrics, previewWithVisibleNewlines } from '../../lib/customer-facing-live-format';
import { decrypt } from '../../lib/encryption';
import { isProductionEnv, safeTextPreviewForLog } from '../../lib/safe-text-preview-for-log';
import type { ReplyDecision, ReplyBubbleDraft } from '../reply-planning/dto';
import { CreditWarningsService } from '../credit-warnings/credit-warnings.service';
import { resolveOutboundChannelForSend } from '../../lib/ghl-channel-routing';
import type { OutboundChannel } from '@aisbp/ghl-client';

export interface BubbleSendResult {
  index: number;
  text: string;
  success: boolean;
  ghlMessageId?: string;
  error?: string;
}

export interface SendSummary {
  conversationId: string;
  tenantId: string;
  totalBubbles: number;
  succeeded: number;
  failed: number;
  bubbleResults: BubbleSendResult[];
  quotaDebited: number; // logical replies debited on success (MVP: 1 or 0)
}

/**
 * OutboundSendService — executes the outbound send pipeline.
 *
 * Responsibilities:
 * - Load GHL connection credentials for the tenant
 * - Send bubbles sequentially via GHL API
 * - Persist each outbound message to the DB
 * - Return a structured SendSummary
 * - Quota is debited only on successful sends (per-bubble counting)
 */
@Injectable()
export class OutboundSendService {
  private readonly logger = new Logger(OutboundSendService.name);
  private readonly supabase = getSupabaseService();

  // Optional so existing tests that `new OutboundSendService()` continue to pass without
  // wiring the warning service; production wires it via Nest DI from OutboundModule.
  constructor(@Optional() private readonly creditWarnings?: CreditWarningsService) {}

  /**
   * Send all bubbles for a ReplyDecision to GHL.
   *
   * Counting rule: 1 quota unit per bubble successfully sent.
   * If any bubble fails, the send is considered partial — caller decides retry.
   */
  async sendReply(params: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    replyPlan: ReplyDecision;
    ghlLocationId: string;
    /** Stable worker job id for idempotent credit debits. */
    sendBubbleJobId?: string;
  }): Promise<SendSummary> {
    const { tenantId, conversationId, contactId, replyPlan, ghlLocationId, sendBubbleJobId } = params;

    // Skip if no bubbles or handover mode
    if (replyPlan.bubbles.length === 0 || replyPlan.planStatus === 'HANDOVER') {
      this.logger.debug(
        `Outbound send skipped: conversationId=${conversationId}, status=${replyPlan.planStatus}`,
      );
      return {
        conversationId,
        tenantId,
        totalBubbles: 0,
        succeeded: 0,
        failed: 0,
        bubbleResults: [],
        quotaDebited: 0,
      };
    }

    const logicalBubbleCount = replyPlan.bubbles.length;
    const sanitizedBubbles = replyPlan.bubbles.map(b => ({
      index: b.index,
      text: sanitizeOutboundCustomerText(b.text),
    }));
    const conversationRow = await this.loadConversationForOutbound(conversationId);
    const conversationChannel = conversationRow?.channel ?? null;
    const outboundGhlChannel = resolveOutboundChannelForSend({
      dbChannel: conversationChannel,
      metadata: conversationRow?.metadata ?? null,
    });
    const whatsappCoalesceEnabled = process.env['WHATSAPP_COALESCE_BUBBLES'] === 'true';
    const skipCoalesceForWhatsApp =
      conversationChannel === 'WHATSAPP' && !whatsappCoalesceEnabled;
    const physicalBubbles = skipCoalesceForWhatsApp
      ? sanitizedBubbles
      : maybeCoalesceOutboundBubbles(sanitizedBubbles);
    const coalesced = physicalBubbles.length < logicalBubbleCount;

    const creditDeductionMethod = await this.getAgencyCreditDeductionMethodForTenant(tenantId);
    const plannedDebitCredits =
      creditDeductionMethod === 'PER_MESSAGE_BUBBLE'
        ? Math.max(1, physicalBubbles.length)
        : 1;

    // Load GHL connection credentials
    const credentials = await this.loadGhlCredentials(tenantId, ghlLocationId);
    if (!credentials) {
      this.logger.error(`Outbound send failed: no GHL credentials for tenant=${tenantId}`);
      return {
        conversationId,
        tenantId,
        totalBubbles: replyPlan.bubbles.length,
        succeeded: 0,
        failed: replyPlan.bubbles.length,
        bubbleResults: replyPlan.bubbles.map(b => ({
          index: b.index,
          text: b.text,
          success: false,
          error: 'No GHL credentials',
        })),
        quotaDebited: 0,
      };
    }

    // Pre-check credits before starting (depends on agency deduction method).
    const quotaOk = await this.checkQuotaAvailable(tenantId, plannedDebitCredits);
    if (!quotaOk) {
      this.logger.warn(`Outbound send blocked: quota exhausted for tenant=${tenantId}`);
      return {
        conversationId,
        tenantId,
        totalBubbles: replyPlan.bubbles.length,
        succeeded: 0,
        failed: replyPlan.bubbles.length,
        bubbleResults: replyPlan.bubbles.map(b => ({
          index: b.index,
          text: b.text,
          success: false,
          error: 'Quota exhausted',
        })),
        quotaDebited: 0,
      };
    }

    const payloadJoined = physicalBubbles.map(b => b.text).join('\n\n');
    const payM = newlineDebugMetrics(payloadJoined);
    const safePayload = safeTextPreviewForLog(payloadJoined, { hashSalt: 'outboundPayload' });
    const preview = previewWithVisibleNewlines(payloadJoined, 500);
    this.logger.log(
      `liveOutboundWhitespace: logicalBubbleCount=${logicalBubbleCount} physicalOutboundBubbleCount=${physicalBubbles.length} ` +
        `outboundCoalesced=${coalesced} conversationChannel=${conversationChannel ?? 'unknown'} ` +
        `ghlOutboundChannel=${outboundGhlChannel} ` +
        `whatsappCoalesceBubbles=${whatsappCoalesceEnabled} outboundPayloadNewlines=${payM.newlineCount} outboundPayloadDoubleNl=${payM.doubleNewlineSeqCount} ` +
        `finalOutboundPreview=${JSON.stringify(safePayload)}` +
        (isProductionEnv() ? '' : ` finalOutboundWhitespacePreview=${JSON.stringify(preview)}`) +
        `conversationId=${conversationId}`,
    );

    const ghlClient = createGhlClient(credentials.token, ghlLocationId);
    const bubbleResults: BubbleSendResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < physicalBubbles.length; i++) {
      const bubble = physicalBubbles[i]!;
      const outboundText = bubble.text;
      const result = await this.sendSingleBubble(ghlClient, {
        locationId: ghlLocationId,
        contactId,
        ghlChannel: outboundGhlChannel,
        bubble: { index: bubble.index, text: outboundText },
      });

      bubbleResults.push(result);

      if (result.success) {
        succeeded++;
        await this.persistOutboundMessage({
          conversationId,
          tenantId,
          contactId,
          content: outboundText,
          contentType: 'TEXT',
          ghlMessageId: result.ghlMessageId,
        });
      } else {
        failed++;
        this.logger.warn(
          `Outbound bubble[${bubble.index}] send failed for conversation=${conversationId}: ${result.error}`,
        );
      }
    }

    let quotaDebited = 0;
    const physicalSendCount = physicalBubbles.length;
    const allSucceeded = physicalSendCount > 0 && succeeded === physicalSendCount && failed === 0;

    let debitAmount = 0;
    if (creditDeductionMethod === 'PER_LOGICAL_REPLY') {
      if (allSucceeded) debitAmount = 1;
    } else {
      // PER_MESSAGE_BUBBLE: debit one credit per successfully sent physical bubble.
      debitAmount = succeeded > 0 ? succeeded : 0;
      if (!allSucceeded && succeeded > 0) {
        this.logger.warn(
          `creditDebitPartial ${JSON.stringify({
            tenantId,
            conversationId,
            reason: 'per_bubble_mode_partial_success',
            physicalSendCount,
            succeeded,
            failed,
            debitAmount,
          })}`,
        );
      }
    }

    if (debitAmount > 0) {
      const idempotencyKey = this.buildReplyDebitIdempotencyKey({
        tenantId,
        conversationId,
        sendBubbleJobId: sendBubbleJobId ?? '',
      });
      const debit = await this.debitQuotaForReply({
        tenantId,
        conversationId,
        idempotencyKey,
        movementType: 'reply_debit',
        description: `Assistant reply debit (conversation ${conversationId})`,
        debitAmount,
        metadata: {
          deductionMethod: creditDeductionMethod,
          logicalBubbleCount,
          physicalSendCount,
          succeeded,
          failed,
        },
      });
      quotaDebited = debit.debited ? debitAmount : 0;
    } else if (failed > 0 && physicalSendCount > 1 && creditDeductionMethod === 'PER_LOGICAL_REPLY') {
      this.logger.warn(
        `quotaDebitSkipped ${JSON.stringify({
          tenantId,
          conversationId,
          reason: 'partial_send_failure',
          physicalSendCount,
          succeeded,
          failed,
        })}`,
      );
    }

    this.logger.log(
      `Outbound send completed: conversationId=${conversationId}, logicalBubbles=${logicalBubbleCount}, ` +
        `physicalSends=${physicalBubbles.length}, succeeded=${succeeded}, failed=${failed}, quotaDebited=${quotaDebited}`,
    );

    return {
      conversationId,
      tenantId,
      totalBubbles: logicalBubbleCount,
      succeeded,
      failed,
      bubbleResults,
      quotaDebited,
    };
  }

  /**
   * Outbound bubble coalesce policy uses `conversations.channel`:
   * - WHATSAPP: do not coalesce by default (one GHL send per logical bubble). Set `WHATSAPP_COALESCE_BUBBLES=true` to restore joining.
   * - Other channels: keep `maybeCoalesceOutboundBubbles` (e.g. SMS) unless extended later.
   * When the row is missing or `select` fails, treat as unknown → allow coalesce (legacy behaviour).
   */
  private async loadConversationForOutbound(
    conversationId: string,
  ): Promise<{ channel: string | null; metadata: Record<string, unknown> | null } | null> {
    try {
      const { data, error } = await this.supabase
        .from('conversations')
        .select('channel, metadata')
        .eq('id', conversationId)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as { channel?: string; metadata?: unknown };
      const ch = typeof row.channel === 'string' && row.channel.trim() ? row.channel.trim().toUpperCase() : null;
      const meta =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;
      return { channel: ch, metadata: meta };
    } catch {
      return null;
    }
  }

  private async sendSingleBubble(
    ghlClient: ReturnType<typeof createGhlClient>,
    params: {
      locationId: string;
      contactId: string;
      ghlChannel: OutboundChannel;
      bubble: ReplyBubbleDraft;
    },
  ): Promise<BubbleSendResult> {
    const { locationId, contactId, bubble, ghlChannel } = params;

    const response = await ghlClient.sendMessage({
      locationId,
      contactId,
      message: bubble.text,
      channel: ghlChannel,
    });

    if (response.success && response.messageId) {
      return {
        index: bubble.index,
        text: bubble.text,
        success: true,
        ghlMessageId: response.messageId,
      };
    }

    return {
      index: bubble.index,
      text: bubble.text,
      success: false,
      error: response.error ?? 'Unknown send error',
    };
  }

  private async loadGhlCredentials(
    tenantId: string,
    ghlLocationId: string,
  ): Promise<{ token: string } | null> {
    const { data } = await this.supabase
      .from('tenant_ghl_connections')
      .select('private_token_encrypted')
      .eq('tenant_id', tenantId)
      .eq('ghl_location_id', ghlLocationId)
      .eq('status', 'CONNECTED')
      .single();

    if (!data) return null;
    try {
      return { token: decrypt(String(data.private_token_encrypted)) };
    } catch (e) {
      this.logger.warn(
        `GHL token decrypt failed tenant=${tenantId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private async checkQuotaAvailable(tenantId: string, needed: number): Promise<boolean> {
    // Agency / system workspaces marked unlimited are never blocked by credit checks.
    if (await this.tenantHasUnlimitedCredits(tenantId)) return true;

    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('total_quota, used_quota, allow_negative_credits, negative_credit_limit')
      .eq('tenant_id', tenantId)
      .single();

    if (!wallet) return true; // No wallet = no quota tracking
    const balance = wallet.total_quota - wallet.used_quota;
    const allowNeg = Boolean(wallet.allow_negative_credits);
    const negLimit = typeof wallet.negative_credit_limit === 'number' ? wallet.negative_credit_limit : 0;
    if (!allowNeg) return balance > 0 && balance >= needed;
    // Allow until balance <= negativeCreditLimit (inclusive).
    return balance > negLimit && balance - needed > negLimit;
  }

  private async tenantHasUnlimitedCredits(tenantId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('tenants')
      .select('credits_unlimited')
      .eq('id', tenantId)
      .maybeSingle();
    return Boolean((data as { credits_unlimited?: boolean } | null)?.credits_unlimited);
  }

  private async getAgencyCreditDeductionMethodForTenant(
    tenantId: string,
  ): Promise<'PER_LOGICAL_REPLY' | 'PER_MESSAGE_BUBBLE'> {
    const { data: t } = await this.supabase.from('tenants').select('agency_id').eq('id', tenantId).maybeSingle();
    if (!t?.agency_id) return 'PER_LOGICAL_REPLY';
    const { data: a } = await this.supabase
      .from('agencies')
      .select('credit_deduction_method')
      .eq('id', t.agency_id as string)
      .maybeSingle();
    const m = (a as { credit_deduction_method?: string } | null)?.credit_deduction_method;
    return m === 'PER_MESSAGE_BUBBLE' ? 'PER_MESSAGE_BUBBLE' : 'PER_LOGICAL_REPLY';
  }

  private buildReplyDebitIdempotencyKey(params: {
    tenantId: string;
    conversationId: string;
    sendBubbleJobId: string;
  }): string {
    const { tenantId, conversationId, sendBubbleJobId } = params;
    const job = sendBubbleJobId.trim() || 'unknown_job';
    return `reply_debit:${tenantId}:${conversationId}:${job}`;
  }

  /**
   * Debit credits for a reply send. Amount is usually 1 (logical reply) or successful bubble count.
   * After a successful (non-idempotent) debit, fires `creditWarnings.maybeSendForCreditDebit`
   * non-blockingly so a warning failure cannot crash or roll back the customer reply.
   */
  private async debitQuotaForReply(params: {
    tenantId: string;
    conversationId: string;
    idempotencyKey: string;
    movementType: 'reply_debit';
    description: string;
    debitAmount: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ debited: boolean }> {
    const { tenantId, conversationId, idempotencyKey, movementType, description, debitAmount, metadata } = params;
    if (!idempotencyKey.trim()) return { debited: false };
    const amt = Math.floor(debitAmount);
    if (!Number.isFinite(amt) || amt < 1) return { debited: false };

    // Unlimited-credit (agency system) workspaces never debit and never warn.
    if (await this.tenantHasUnlimitedCredits(tenantId)) {
      this.logger.log(
        `quotaDebitSkipped ${JSON.stringify({
          tenantId,
          conversationId,
          reason: 'unlimited_credits_workspace',
        })}`,
      );
      return { debited: false };
    }

    // Idempotency: check ledger first (best-effort; DB unique index is primary protection in prod).
    const { data: existing } = await this.supabase
      .from('quota_ledgers')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing?.id) {
      this.logger.log(
        `quotaDebitSkipped ${JSON.stringify({
          tenantId,
          conversationId,
          reason: 'duplicate_idempotency_key',
        })}`,
      );
      return { debited: false };
    }

    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('id, total_quota, used_quota, period_start, period_end')
      .eq('tenant_id', tenantId)
      .single();

    if (!wallet) return { debited: false };

    const balanceBefore = wallet.total_quota - wallet.used_quota;
    const nextUsed = wallet.used_quota + amt;
    const balanceAfter = wallet.total_quota - nextUsed;

    await this.supabase
      .from('quota_wallets')
      .update({ used_quota: nextUsed, updated_at: new Date().toISOString() })
      .eq('id', wallet.id);

    const { error: ledErr } = await this.supabase.from('quota_ledgers').insert({
      id: randomUUID(),
      wallet_id: wallet.id,
      amount: amt,
      type: 'DEBIT',
      movement_type: movementType,
      balance_after: balanceAfter,
      idempotency_key: idempotencyKey,
      description,
      conversation_id: conversationId,
      metadata: { ...(metadata ?? {}), logicalReply: amt === 1 },
      created_by_user_id: null,
    });
    if (ledErr) {
      // If this is a unique conflict, treat as idempotent skip.
      const msg = formatPostgrestError(ledErr);
      if (/idempotency_key/i.test(msg) || /duplicate/i.test(msg) || /unique/i.test(msg)) {
        this.logger.log(
          `quotaDebitSkipped ${JSON.stringify({
            tenantId,
            conversationId,
            reason: 'duplicate_idempotency_key',
          })}`,
        );
        return { debited: false };
      }
      throw new Error(`Failed to insert quota ledger: ${msg}`);
    }

    // Trigger automated low-credit warning. Always non-blocking — warning failures must not
    // bubble back into the outbound send pipeline. Detached promise is intentional.
    if (this.creditWarnings) {
      const warner = this.creditWarnings;
      const periodStart = wallet.period_start ? new Date(String(wallet.period_start)).toISOString() : null;
      const periodEnd = wallet.period_end ? new Date(String(wallet.period_end)).toISOString() : null;
      void warner
        .maybeSendForCreditDebit({
          tenantId,
          balanceBefore,
          balanceAfter,
          periodStart,
          periodEnd,
          triggerSource: 'reply_debit',
        })
        .then(result => {
          if (result.status !== 'SKIPPED' || result.reason !== 'no_threshold_crossed') {
            this.logger.log(
              `lowCreditWarning ${JSON.stringify({
                tenantId,
                conversationId,
                status: result.status,
                threshold: 'threshold' in result ? result.threshold : null,
                reason: 'reason' in result ? result.reason : null,
              })}`,
            );
          }
        })
        .catch(e => {
          this.logger.warn(
            `lowCreditWarning fire-and-forget rejected tenant=${tenantId} ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    }

    return { debited: true };
  }

  private async persistOutboundMessage(params: {
    conversationId: string;
    tenantId: string;
    contactId: string;
    content: string;
    contentType: string;
    ghlMessageId?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error: insErr } = await this.supabase.from('messages').insert({
      id: randomUUID(),
      conversation_id: params.conversationId,
      direction: 'OUTBOUND',
      sender: 'AI',
      content: params.content,
      contentType: params.contentType,
      metadata: {
        ghlMessageId: params.ghlMessageId,
        sentAt: now,
      },
    });
    if (insErr) {
      this.logger.error(
        `Failed to persist outbound message: ${formatPostgrestError(insErr)}`,
      );
      throw new Error(`Failed to persist outbound message: ${formatPostgrestError(insErr)}`);
    }

    const { error: convErr } = await this.supabase
      .from('conversations')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', params.conversationId);
    if (convErr) {
      this.logger.warn(
        `Outbound message saved but conversation touch failed: ${formatPostgrestError(convErr)}`,
      );
    }
  }
}
