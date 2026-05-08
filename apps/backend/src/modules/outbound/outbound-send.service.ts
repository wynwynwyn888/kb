// Outbound Send Service — sends reply bubbles through GHL and tracks results.
// Does NOT make routing/AI decisions — only executes the send plan.
// Expects `ReplyDecision.bubbles` as produced by orchestration (ReplyPlannerService formatting
// is already applied). Outbound channel is fixed to SMS in sendSingleBubble until GHL mapping
// for other channels is verified (see @aisbp/ghl-client CHANNEL_MAP) — not derived from
// conversation context in this service.

import { Injectable, Logger } from '@nestjs/common';
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

    // Pre-check quota before starting (logical reply = 1 credit)
    const quotaOk = await this.checkQuotaAvailable(tenantId, 1);
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

    const logicalBubbleCount = replyPlan.bubbles.length;
    const sanitizedBubbles = replyPlan.bubbles.map(b => ({
      index: b.index,
      text: sanitizeOutboundCustomerText(b.text),
    }));
    const physicalBubbles = maybeCoalesceOutboundBubbles(sanitizedBubbles);
    const coalesced = physicalBubbles.length < logicalBubbleCount;

    const payloadJoined = physicalBubbles.map(b => b.text).join('\n\n');
    const payM = newlineDebugMetrics(payloadJoined);
    const safePayload = safeTextPreviewForLog(payloadJoined, { hashSalt: 'outboundPayload' });
    const preview = previewWithVisibleNewlines(payloadJoined, 500);
    this.logger.log(
      `liveOutboundWhitespace: logicalBubbleCount=${logicalBubbleCount} physicalOutboundBubbleCount=${physicalBubbles.length} ` +
        `outboundCoalesced=${coalesced} outboundPayloadNewlines=${payM.newlineCount} outboundPayloadDoubleNl=${payM.doubleNewlineSeqCount} ` +
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
    if (allSucceeded) {
      const idempotencyKey = this.buildReplyDebitIdempotencyKey({
        tenantId,
        conversationId,
        sendBubbleJobId: sendBubbleJobId ?? '',
      });
      const debit = await this.debitQuotaForLogicalReply({
        tenantId,
        conversationId,
        idempotencyKey,
        movementType: 'reply_debit',
        description: `Assistant reply debit (conversation ${conversationId})`,
      });
      quotaDebited = debit.debited ? 1 : 0;
    } else if (failed > 0 && physicalSendCount > 1) {
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

  private async sendSingleBubble(
    ghlClient: ReturnType<typeof createGhlClient>,
    params: {
      locationId: string;
      contactId: string;
      bubble: ReplyBubbleDraft;
    },
  ): Promise<BubbleSendResult> {
    const { locationId, contactId, bubble } = params;

    // SMS is the only verified outbound channel in ghl-client today; do not switch here until verified.
    const response = await ghlClient.sendMessage({
      locationId,
      contactId,
      message: bubble.text,
      channel: 'SMS',
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

  private buildReplyDebitIdempotencyKey(params: {
    tenantId: string;
    conversationId: string;
    sendBubbleJobId: string;
  }): string {
    const { tenantId, conversationId, sendBubbleJobId } = params;
    const job = sendBubbleJobId.trim() || 'unknown_job';
    return `reply_debit:${tenantId}:${conversationId}:${job}`;
  }

  private async debitQuotaForLogicalReply(params: {
    tenantId: string;
    conversationId: string;
    idempotencyKey: string;
    movementType: 'reply_debit';
    description: string;
  }): Promise<{ debited: boolean }> {
    const { tenantId, conversationId, idempotencyKey, movementType, description } = params;
    if (!idempotencyKey.trim()) return { debited: false };

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
      .select('id, total_quota, used_quota')
      .eq('tenant_id', tenantId)
      .single();

    if (!wallet) return { debited: false };

    const nextUsed = wallet.used_quota + 1;
    const balanceAfter = wallet.total_quota - nextUsed;

    await this.supabase
      .from('quota_wallets')
      .update({ used_quota: nextUsed, updated_at: new Date().toISOString() })
      .eq('id', wallet.id);

    const { error: ledErr } = await this.supabase.from('quota_ledgers').insert({
      id: randomUUID(),
      wallet_id: wallet.id,
      amount: 1,
      type: 'DEBIT',
      movement_type: movementType,
      balance_after: balanceAfter,
      idempotency_key: idempotencyKey,
      description,
      conversation_id: conversationId,
      metadata: { logicalReply: true },
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
