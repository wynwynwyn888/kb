// Outbound Send Service — sends reply bubbles through GHL and tracks results.
// Does NOT make routing/AI decisions — only executes the send plan.
// Expects `ReplyDecision.bubbles` as produced by orchestration (ReplyPlannerService formatting
// is already applied). Outbound channel is fixed to SMS in sendSingleBubble until GHL mapping
// for other channels is verified (see @aisbp/ghl-client CHANNEL_MAP) — not derived from
// conversation context in this service.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { createGhlClient } from '@aisbp/ghl-client';
import { decrypt, safeLog } from '../../lib/encryption';
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
  quotaDebited: number; // bubbles debited on success
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
  }): Promise<SendSummary> {
    const { tenantId, conversationId, contactId, replyPlan, ghlLocationId } = params;

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

    // Pre-check quota before starting
    const quotaOk = await this.checkQuotaAvailable(tenantId, replyPlan.bubbles.length);
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

    // Send bubbles sequentially
    const bubbleResults: BubbleSendResult[] = [];
    let succeeded = 0;
    let failed = 0;
    const ghlClient = createGhlClient(credentials.token, ghlLocationId);

    for (const bubble of replyPlan.bubbles) {
      const result = await this.sendSingleBubble(ghlClient, {
        locationId: ghlLocationId,
        contactId,
        bubble,
      });

      bubbleResults.push(result);

      if (result.success) {
        succeeded++;
        // Persist outbound message record
        await this.persistOutboundMessage({
          conversationId,
          tenantId,
          contactId,
          content: bubble.text,
          contentType: 'TEXT',
          ghlMessageId: result.ghlMessageId,
        });
        // Debit quota for this bubble
        await this.debitQuota(tenantId, 1, conversationId);
      } else {
        failed++;
        this.logger.warn(
          `Bubble[${bubble.index}] send failed for conversation=${conversationId}: ${result.error}`,
        );
        // Do NOT persist failed sends or debit quota for them
      }
    }

    this.logger.log(
      `Outbound send completed: conversationId=${conversationId}, total=${replyPlan.bubbles.length}, ` +
      `succeeded=${succeeded}, failed=${failed}`,
    );

    return {
      conversationId,
      tenantId,
      totalBubbles: replyPlan.bubbles.length,
      succeeded,
      failed,
      bubbleResults,
      quotaDebited: succeeded, // 1 unit per bubble sent
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
      .select('total_quota, used_quota')
      .eq('tenant_id', tenantId)
      .single();

    if (!wallet) return true; // No wallet = no quota tracking
    return wallet.total_quota - wallet.used_quota >= needed;
  }

  private async debitQuota(
    tenantId: string,
    amount: number,
    conversationId: string,
  ): Promise<void> {
    // Debit from wallet
    const { data: wallet } = await this.supabase
      .from('quota_wallets')
      .select('id, used_quota')
      .eq('tenant_id', tenantId)
      .single();

    if (!wallet) return;

    await this.supabase
      .from('quota_wallets')
      .update({ used_quota: wallet.used_quota + amount })
      .eq('tenant_id', tenantId);

    // Record ledger entry
    await this.supabase.from('quota_ledgers').insert({
      wallet_id: wallet.id,
      amount,
      type: 'DEBIT',
      description: `Outbound send for conversation ${conversationId}`,
      conversation_id: conversationId,
    });
  }

  private async persistOutboundMessage(params: {
    conversationId: string;
    tenantId: string;
    contactId: string;
    content: string;
    contentType: string;
    ghlMessageId?: string;
  }): Promise<void> {
    await this.supabase.from('messages').insert({
      conversation_id: params.conversationId,
      direction: 'OUTBOUND',
      sender: 'AI',
      content: params.content,
      content_type: params.contentType,
      metadata: {
        ghlMessageId: params.ghlMessageId,
        sentAt: new Date().toISOString(),
      },
    });

    // Update conversation lastMessageAt
    await this.supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', params.conversationId);
  }
}
