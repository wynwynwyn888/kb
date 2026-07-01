// Outbound Send Service — sends reply bubbles through GHL and tracks results.
// Does NOT make routing/AI decisions — only executes the send plan.
// Expects `ReplyDecision.bubbles` as produced by orchestration (ReplyPlannerService formatting
// is already applied). Outbound GHL send type is chosen from conversation metadata /
// `conversations.channel` (see `ghl-channel-routing` + @aisbp/ghl-client CHANNEL_MAP).

import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import {
  mergeConversationMetadataForPersist,
  readConversationMetadataField,
} from '../../lib/conversation-metadata-merge';
import { getSupabaseService } from '../../lib/supabase';
import { createGhlClient } from '@aisbp/ghl-client';
import { sanitizeOutboundCustomerText } from '../../lib/outbound-customer-text';
import { maybeCoalesceOutboundBubbles } from '../../lib/outbound-coalesce';
import { newlineDebugMetrics, previewWithVisibleNewlines } from '../../lib/customer-facing-live-format';
import { decrypt } from '../../lib/encryption';
import { isProductionEnv, safeTextPreviewForLog } from '../../lib/safe-text-preview-for-log';
import type { ReplyDecision, ReplyBubbleDraft } from '../reply-planning/dto';
import { CreditWarningsService } from '../credit-warnings/credit-warnings.service';
import { MetricsService } from '../../lib/metrics.service';
import {
  ghlOutboundExpandChannelAttempts,
  ghlOutboundFallbackChannels,
  isGhlMetaSiblingChannelRetryable,
  metadataPatchForSuccessfulOutbound,
  resolveOutboundChannelForSend,
} from '../../lib/ghl-channel-routing';
import type { OutboundChannel } from '@aisbp/ghl-client';

export interface BubbleSendResult {
  index: number;
  text: string;
  success: boolean;
  skippedDuplicate?: boolean;
  /** GHL channel that actually delivered the message (after fallback). */
  ghlChannelUsed?: OutboundChannel;
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
  constructor(
    @Optional() private readonly creditWarnings?: CreditWarningsService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

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
    /** Stable id for this AI reply (per-send idempotency key component). */
    replyId?: string;
  }): Promise<SendSummary> {
    const { tenantId, conversationId, contactId, replyPlan, ghlLocationId, sendBubbleJobId, replyId } = params;

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

    const jobId = sendBubbleJobId?.trim() ?? '';
    const alreadySent =
      jobId.length > 0
        ? await this.fetchAlreadySentBubbleIndices(conversationId, jobId)
        : new Set<number>();

    for (let i = 0; i < physicalBubbles.length; i++) {
      const bubble = physicalBubbles[i]!;

      // Idempotency guard: check ledger first (feature-flagged, off by default)
      if (replyId) {
        const claimed = await this.claimOutboundSend({
          tenantId,
          conversationId,
          ghlLocationId,
          replyId,
          bubbleSequence: bubble.index,
          content: bubble.text,
          sendBubbleJobId: jobId,
        });
          if (claimed === null && process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] === 'true') {
          this.metrics?.emit({ tenantId, conversationId, eventType: 'duplicate_send_prevented', eventSource: 'outbound-send', metadata: { replyId, bubbleSequence: bubble.index } });
          bubbleResults.push({
            index: bubble.index,
            text: bubble.text,
            success: true,
            skippedDuplicate: true,
          });
          succeeded++;
          continue;
        }
      }

      // Fallback: existing soft-dedup (active regardless of flag)
      if (alreadySent.has(bubble.index)) {
        bubbleResults.push({
          index: bubble.index,
          text: bubble.text,
          success: true,
          skippedDuplicate: true,
        });
        succeeded++;
        continue;
      }
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
        this.metrics?.emit({ tenantId, conversationId, eventType: 'outbound_send_sent', eventSource: 'outbound-send', metadata: { replyId: replyId ?? undefined, bubbleSequence: bubble.index, ghlChannel: result.ghlChannelUsed, ghlMessageId: result.ghlMessageId } });
        if (result.ghlChannelUsed) {
          await this.persistConversationOutboundChannel(conversationId, result.ghlChannelUsed);
        }
        await this.persistOutboundMessage({
          conversationId,
          tenantId,
          contactId,
          content: outboundText,
          contentType: 'TEXT',
          ghlMessageId: result.ghlMessageId,
          sendBubbleJobId: jobId || undefined,
          bubbleIndex: bubble.index,
        });
        if (replyId) {
          await this.updateOutboundSendResult({
            tenantId, conversationId, replyId, bubbleSequence: bubble.index,
            status: 'sent',
            providerMessageId: result.ghlMessageId,
          });
        }
      } else {
        failed++;
        this.metrics?.emit({ tenantId, conversationId, eventType: 'outbound_send_failed', eventSource: 'outbound-send', severity: 'error', metadata: { replyId: replyId ?? undefined, bubbleSequence: bubble.index, error: result.error } });
        if (replyId) {
          await this.updateOutboundSendResult({
            tenantId, conversationId, replyId, bubbleSequence: bubble.index,
            status: 'failed_provider_rejected',
            errorCode: result.error ?? undefined,
          });
        }
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
    const { locationId, bubble, ghlChannel } = params;
    const resolvedContactId = await this.resolveContactIdIfPhone(ghlClient, params.locationId, params.contactId);
    const contactId = resolvedContactId ?? params.contactId;

    const tryChannels: OutboundChannel[] = [...ghlOutboundFallbackChannels(ghlChannel)];
    let lastError = 'Unknown send error';
    let attemptIndex = 0;

    while (attemptIndex < tryChannels.length) {
      const ch = tryChannels[attemptIndex]!;
      attemptIndex += 1;

      const response = await ghlClient.sendMessage({
        locationId,
        contactId,
        message: bubble.text,
        channel: ch,
      });

      // 429 rate-limit: log and abort (BullMQ retries with backoff)
      if (response.error?.includes('Rate limited')) {
        this.metrics?.emit({ eventType: 'ghl_api_rate_limited', eventSource: 'outbound-send', severity: 'warn', metadata: { locationId, channel: ch } });
        this.logger.warn(
          `ghl429RateLimited: locationId=${locationId} channel=${ch}`,
        );
        return {
          index: bubble.index,
          text: bubble.text,
          success: false,
          error: 'Rate limited by GHL API',
        };
      }

      if (response.success && response.messageId) {
        if (ch !== ghlChannel) {
          this.logger.log(
            `ghlOutboundChannelFallback: primary=${ghlChannel} used=${ch} contactId=${contactId}`,
          );
        }
        return {
          index: bubble.index,
          text: bubble.text,
          success: true,
          ghlMessageId: response.messageId,
          ghlChannelUsed: ch,
        };
      }

      lastError = response.error ?? 'Unknown send error';
      const hasMoreQueued = attemptIndex < tryChannels.length;
      if (hasMoreQueued && isGhlMetaSiblingChannelRetryable(lastError)) {
        continue;
      }

      const queueLenBefore = tryChannels.length;
      ghlOutboundExpandChannelAttempts(ghlChannel, ch, lastError, tryChannels);
      if (tryChannels.length > queueLenBefore) {
        continue;
      }
      break;
    }

    return {
      index: bubble.index,
      text: bubble.text,
      success: false,
      error: lastError,
    };
  }

  /**
   * Resolve a contact ID that looks like a phone number to the internal GHL contact ID.
   * Returns null if the contactId is not phone-format or resolution fails.
   */
  private async resolveContactIdIfPhone(
    ghlClient: ReturnType<typeof createGhlClient>,
    locationId: string,
    contactId: string,
  ): Promise<string | null> {
    if (!/^\+[0-9]{7,}$/.test(contactId.trim())) return null;

    try {
      const result = await ghlClient.findContactByPhone(locationId, contactId.trim());

      if (!result.success) {
        this.logger.warn(
          `contactIdPhoneResolveFailed: contactId=${contactId.trim()} locationId=${locationId} error=${result.error ?? 'unknown'}`,
        );
        return null;
      }

      if (!result.contact?.id) {
        this.logger.warn(
          `contactIdPhoneResolveNoMatch: contactId=${contactId.trim()} locationId=${locationId} — no GHL contact found`,
        );
        return null;
      }

      this.logger.log(
        `contactIdPhoneResolved: contactId=${contactId.trim()} → ghlContactId=${result.contact.id}`,
      );
      this.metrics?.emit({ eventType: 'contact_id_phone_fallback_resolved', eventSource: 'outbound-send', metadata: { locationId, resolvedId: result.contact.id } });
      return result.contact.id;
    } catch (e) {
      this.logger.warn(
        `contactIdPhoneResolveError: contactId=${contactId.trim()} error=${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private async persistConversationOutboundChannel(
    conversationId: string,
    channelUsed: OutboundChannel,
  ): Promise<void> {
    const patch = metadataPatchForSuccessfulOutbound(channelUsed);
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data) return;
    const prev = readConversationMetadataField(data?.metadata);
    const incoming = {
      ghlOutboundChannel: patch.ghlOutboundChannel,
      channelIdentity: patch.channelIdentity,
    };
    const merged = mergeConversationMetadataForPersist(prev, incoming);
    const updateRow = {
      metadata: merged,
      channel: patch.dbChannel,
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await this.supabase
      .from('conversations')
      .update(updateRow)
      .eq('id', conversationId);
    if (upErr) {
      this.logger.warn(
        `persistConversationOutboundChannelFailed ${JSON.stringify({
          conversationId,
          channelUsed,
          message: formatPostgrestError(upErr),
        })}`,
      );
      return;
    }
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
      .maybeSingle();

    if (!wallet) return true;
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

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: wallet } = await this.supabase
        .from('quota_wallets')
        .select('id, total_quota, used_quota, period_start, period_end')
        .eq('tenant_id', tenantId)
        .single();

      if (!wallet) return { debited: false };

      const balanceBefore = wallet.total_quota - wallet.used_quota;
      const nextUsed = wallet.used_quota + amt;
      const balanceAfter = wallet.total_quota - nextUsed;

      const { data: updatedWallet, error: walletUpErr } = await this.supabase
        .from('quota_wallets')
        .update({ used_quota: nextUsed, updated_at: new Date().toISOString() })
        .eq('id', wallet.id)
        .eq('used_quota', wallet.used_quota)
        .select('id')
        .maybeSingle();

      if (walletUpErr || !updatedWallet?.id) {
        this.logger.warn(
          `quotaDebitConflict ${JSON.stringify({
            tenantId,
            conversationId,
            walletId: wallet.id,
            attempt: attempt + 1,
            message: walletUpErr ? formatPostgrestError(walletUpErr) : 'optimistic_lock_miss',
          })}`,
        );
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 40 * (attempt + 1)));
          continue;
        }
        return { debited: false };
      }

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
        await this.supabase
          .from('quota_wallets')
          .update({ used_quota: wallet.used_quota, updated_at: new Date().toISOString() })
          .eq('id', wallet.id)
          .eq('used_quota', nextUsed);
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

    return { debited: false };
  }

  private async fetchAlreadySentBubbleIndices(
    conversationId: string,
    sendBubbleJobId: string,
  ): Promise<Set<number>> {
    try {
      const { data } = await this.supabase
        .from('messages')
        .select('metadata')
        .eq('conversation_id', conversationId)
        .eq('direction', 'OUTBOUND')
        .eq('sender', 'AI')
        .order('created_at', { ascending: false })
        .limit(30);
      const sent = new Set<number>();
      for (const row of data ?? []) {
        const md = row.metadata as Record<string, unknown> | null;
        if (!md || md['sendBubbleJobId'] !== sendBubbleJobId) continue;
        const idx = md['bubbleIndex'];
        if (typeof idx === 'number' && Number.isFinite(idx)) sent.add(Math.floor(idx));
      }
      return sent;
    } catch {
      return new Set<number>();
    }
  }

  private async persistOutboundMessage(params: {
    conversationId: string;
    tenantId: string;
    contactId: string;
    content: string;
    contentType: string;
    ghlMessageId?: string;
    sendBubbleJobId?: string;
    bubbleIndex?: number;
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
        ...(params.sendBubbleJobId ? { sendBubbleJobId: params.sendBubbleJobId } : {}),
        ...(typeof params.bubbleIndex === 'number' ? { bubbleIndex: params.bubbleIndex } : {}),
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

  /**
   * Try to claim a send slot in the outbound idempotency ledger.
   * Returns null if this bubble was already sent (duplicate prevented).
   * Returns the row id if a new pending row was created (proceed to send).
   */
  private async claimOutboundSend(params: {
    tenantId: string;
    conversationId: string;
    ghlLocationId: string;
    replyId: string;
    bubbleSequence: number;
    content: string;
    sendBubbleJobId: string;
  }): Promise<{ id: string; status: string } | null> {
    if (process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] !== 'true') return null;
    try {
      const { error: insErr } = await this.supabase.from('outbound_sends').insert({
        id: randomUUID(),
        tenant_id: params.tenantId,
        conversation_id: params.conversationId,
        reply_id: params.replyId,
        bubble_sequence: params.bubbleSequence,
        ghl_location_id: params.ghlLocationId,
        content_hash: params.content.slice(0, 64),
        status: 'pending',
        job_id: params.sendBubbleJobId,
        attempt: 1,
      });
      if (insErr) {
        const msg = formatPostgrestError(insErr);
        if (msg.includes('unique') || msg.includes('23505') || msg.includes('conflict')) {
          const reclaimed = await this.reclaimOutboundSendOnRetry(params);
          if (reclaimed) {
            this.logger.log(
              `outboundIdempotencyRetry: tenantId=${params.tenantId} conversationId=${params.conversationId} replyId=${params.replyId} bubble=${params.bubbleSequence} attempt=${reclaimed.attempt}`,
            );
            return reclaimed;
          }
          this.logger.log(
            `outboundIdempotencyDuplicate: tenantId=${params.tenantId} conversationId=${params.conversationId} replyId=${params.replyId} bubble=${params.bubbleSequence}`,
          );
          return null;
        }
        this.logger.error(`claimOutboundSend insert error: ${msg}`);
        return null;
      }
      return { id: '', status: 'pending' };
    } catch (e) {
      this.logger.warn(`claimOutboundSend catch: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * Attempt to reclaim an existing failed outbound_sends row for retry.
   * Only rows with terminal failure statuses are eligible for reclamation.
   * The update is conditional on the row still having the eligible status to
   * prevent concurrent reclaims.
   */
  private async reclaimOutboundSendOnRetry(params: {
    tenantId: string;
    conversationId: string;
    replyId: string;
    bubbleSequence: number;
    sendBubbleJobId: string;
  }): Promise<{ id: string; status: string; attempt: number } | null> {
    const eligibleStatuses = [
      'failed_provider_rejected',
      'failed_before_provider',
      'dead_lettered',
      'unknown_provider_outcome',
    ];

    const { data: existing } = await this.supabase
      .from('outbound_sends')
      .select('id, status, attempt')
      .eq('tenant_id', params.tenantId)
      .eq('conversation_id', params.conversationId)
      .eq('reply_id', params.replyId)
      .eq('bubble_sequence', params.bubbleSequence)
      .maybeSingle();

    if (!existing) return null;

    const existingRow = existing as { id: string; status: string; attempt: number };
    if (!eligibleStatuses.includes(existingRow.status)) return null;

    const newAttempt = existingRow.attempt + 1;

    const { error: upErr } = await this.supabase
      .from('outbound_sends')
      .update({
        status: 'pending',
        attempt: newAttempt,
        last_error_code: null,
        last_error_message: null,
        sent_at: null,
        updated_at: new Date().toISOString(),
        job_id: params.sendBubbleJobId,
      })
      .eq('tenant_id', params.tenantId)
      .eq('conversation_id', params.conversationId)
      .eq('reply_id', params.replyId)
      .eq('bubble_sequence', params.bubbleSequence)
      .in('status', eligibleStatuses);

    if (upErr) {
      this.logger.warn(
        `reclaimOutboundSendOnRetry update error: ${formatPostgrestError(upErr)}`,
      );
      return null;
    }

    return { id: existingRow.id, status: 'pending', attempt: newAttempt };
  }

  private async updateOutboundSendResult(params: {
    tenantId: string;
    conversationId: string;
    replyId: string;
    bubbleSequence: number;
    status: string;
    providerMessageId?: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    if (process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] !== 'true') return;
    try {
      const update: Record<string, unknown> = {
        status: params.status,
        updated_at: new Date().toISOString(),
        ...(params.providerMessageId ? { provider_message_id: params.providerMessageId } : {}),
        ...(params.errorCode ? { last_error_code: params.errorCode } : {}),
        ...(params.errorMessage ? { last_error_message: params.errorMessage } : {}),
      };
      if (params.status === 'sent') {
        update['sent_at'] = new Date().toISOString();
      }
      const { error } = await this.supabase
        .from('outbound_sends')
        .update(update)
        .eq('tenant_id', params.tenantId)
        .eq('conversation_id', params.conversationId)
        .eq('reply_id', params.replyId)
        .eq('bubble_sequence', params.bubbleSequence);
      if (error) {
        this.logger.warn(`updateOutboundSendResult error: ${formatPostgrestError(error)}`);
      }
    } catch (e) {
      this.logger.warn(`updateOutboundSendResult catch: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Send-time stale reply check (feature-flagged, off by default).
   * Returns true if a newer inbound message arrived after AI generation started.
   */
  async isReplyStale(
    conversationId: string,
    latestInboundMsgIdAtStart: string,
  ): Promise<boolean> {
    if (!latestInboundMsgIdAtStart) return false;
    if (process.env['AISBP_STALE_SEND_CHECK_ENABLED'] !== 'true') return false;
    try {
      const { data, error } = await this.supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('direction', 'INBOUND')
        .eq('sender', 'CONTACT')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return false;
      const latestId = typeof data.id === 'string' ? data.id : '';
      return latestId !== '' && latestId !== latestInboundMsgIdAtStart;
    } catch (e) {
      this.logger.warn(`isReplyStale check failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Check prior-bubble status for per-conversation ordering.
   * Returns null if this bubble can proceed (predecessor is 'sent' or this is bubble 0).
   * Returns 'wait' if predecessor is still pending/processing (should retry after delay).
   * Returns 'cancel' if predecessor is stale/cancelled/dead-lettered (should cancel this bubble too).
   */
  async checkPriorBubble(
    tenantId: string,
    conversationId: string,
    replyId: string,
    bubbleSequence: number,
  ): Promise<'proceed' | 'wait' | 'cancel'> {
    if (bubbleSequence === 0) return 'proceed';
    try {
      const { data, error } = await this.supabase
        .from('outbound_sends')
        .select('status')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversationId)
        .eq('reply_id', replyId)
        .eq('bubble_sequence', bubbleSequence - 1)
        .maybeSingle();
      if (error) return 'wait'; // Real DB error — let the send-bubble job retry
      // Predecessor row does not exist in outbound_sends yet.
      // For same-reply multi-bubble batches this is expected: bubble 0 will be
      // created by the same sendReply() call. The conversation ordering lock
      // already guards cross-reply interleaving.
      // Returning 'proceed' fixes the bug where 2‑bubble replies were cancelled
      // by their own not-yet-inserted predecessor.
      if (!data) return 'proceed';
      const status = data.status as string;
      if (status === 'sent') return 'proceed';
      if (['pending', 'processing', 'failed_before_provider', 'failed_provider_rejected'].includes(status)) return 'wait';
      // stale, cancelled, dead_lettered, unknown → cancel this bubble too
      return 'cancel';
    } catch (e) {
      this.logger.warn(`checkPriorBubble error: ${e instanceof Error ? e.message : String(e)}`);
      return 'wait';
    }
  }
}

