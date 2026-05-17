import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { buildReadableFallbackInternalSummary } from '../../lib/human-escalation-summary';
import {
  formatHandoverChannelLabel,
  formatInternalEscalationCustomerLines,
  internalAlertChannelSlugFromLabel,
  internalAlertChannelSlugFromOutbound,
  type InternalAlertChannelSlug,
} from '../../lib/handover-display';
import type { OutboundChannel } from '@aisbp/ghl-client';
import type { MemoryEntry } from '../orchestration/dto/memory-entry';
import { ConversationsService } from '../conversations/conversations.service';
import { FollowUpEngineService } from '../follow-up-engine/follow-up-engine.service';
import { HumanEscalationSettingsService } from './human-escalation-settings.service';
import { HumanEscalationNotifyService } from './human-escalation-notify.service';
import { GhlService } from '../ghl/ghl.service';
import { GenerationService } from '../generation/generation.service';

const HUMAN_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const AI_NEEDS_HUMAN_REVIEW_TAG = 'ai_needs_human_review';

/** Staged on conversation metadata until first successful customer ack outbound (channel known). */
export interface PendingHumanEscalationInternalAlert {
  latestInboundMessage: string;
  summary: string;
  customerName: string;
  phoneForAlert: string | null;
  contactId: string | null;
}

function pickContactDisplayName(contact: Record<string, unknown>): string | null {
  const fn = typeof contact['firstName'] === 'string' ? contact['firstName'].trim() : '';
  const ln = typeof contact['lastName'] === 'string' ? contact['lastName'].trim() : '';
  const full = [fn, ln].filter(Boolean).join(' ').trim();
  if (full) return full;
  const name = typeof contact['name'] === 'string' ? contact['name'].trim() : '';
  return name || null;
}

function pickContactPhone(contact: Record<string, unknown>): string | null {
  for (const k of ['phone', 'phoneNumber', 'primaryPhone', 'mobile']) {
    const v = contact[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

@Injectable()
export class HumanEscalationRuntimeService {
  private readonly logger = new Logger(HumanEscalationRuntimeService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly conversations: ConversationsService,
    private readonly followUpEngine: FollowUpEngineService,
    private readonly escalationSettings: HumanEscalationSettingsService,
    private readonly notify: HumanEscalationNotifyService,
    private readonly ghlService: GhlService,
    private readonly generation: GenerationService,
  ) {}

  /**
   * Idempotent side effects for deterministic HUMAN_HANDOVER intent: handover row, cancel follow-ups, optional team SMS, CRM tag.
   */
  async onHumanHandoverIntent(params: {
    tenantId: string;
    /** Reserved for future alert context; not included in staff SMS when CRM name/phone exist. */
    tenantDisplayName?: string | null;
    conversationId: string;
    contactId?: string | null;
    latestInboundMessage: string;
    memoryEntries: MemoryEntry[];
    contactPhone?: string | null;
    contactDisplayName?: string | null;
  }): Promise<{ escalated: boolean; alreadyInHandover: boolean }> {
    const {
      tenantId,
      conversationId,
      contactId,
      latestInboundMessage,
      memoryEntries,
      contactPhone,
      contactDisplayName,
    } = params;

    const settings = await this.escalationSettings.getSettings(tenantId);
    const alreadyInHandover = await this.conversations.isInHandover(conversationId);

    if (!settings.enabled) {
      this.logger.log(
        `humanEscalationSkipped ${JSON.stringify({
          reason: 'human_escalation_disabled',
          tenantId,
          conversationId,
          contactId: contactId ?? null,
        })}`,
      );
      return { escalated: false, alreadyInHandover };
    }

    this.logger.log(
      `humanEscalationDetected ${JSON.stringify({
        tenantId,
        conversationId,
        contactId: contactId ?? null,
      })}`,
    );
    if (!alreadyInHandover) {
      try {
        await this.conversations.pauseForHandover(
          conversationId,
          'REQUEST',
          'AI',
          'human_intent:HUMAN_HANDOVER',
        );
      } catch (e) {
        this.logger.warn(
          `humanEscalationHandoverPauseFailed ${JSON.stringify({
            conversationId,
            message: e instanceof Error ? e.message : String(e),
          })}`,
        );
      }
      await this.applyAiNeedsHumanReviewTag(tenantId, contactId);
    }

    await this.followUpEngine.cancelPendingJobsForHumanEscalation({ tenantId, conversationId });

    const rawNum = settings.teamNotificationNumber?.trim();
    if (!rawNum) {
      this.logger.log(`humanEscalationSettingsMissing ${JSON.stringify({ reason: 'no_team_notification_number' })}`);
      return { escalated: true, alreadyInHandover };
    }

    const lastSentIso = await this.readHumanEscalationAlertSentAt(conversationId);
    if (
      alreadyInHandover &&
      typeof lastSentIso === 'string' &&
      Date.now() - Date.parse(lastSentIso) < HUMAN_ALERT_COOLDOWN_MS
    ) {
      this.logger.log(
        `humanEscalationDuplicateSuppressed ${JSON.stringify({
          conversationId,
          tenantId,
          lastSentIso,
        })}`,
      );
      return { escalated: true, alreadyInHandover };
    }

    const crm = await this.resolveCrmContactForAlert(tenantId, contactId, contactDisplayName, contactPhone);

    let summary: string;
    const aiSummary = await this.tryAiInternalSummary(tenantId, latestInboundMessage, memoryEntries);
    if (aiSummary) {
      summary = aiSummary;
    } else {
      try {
        summary = buildReadableFallbackInternalSummary(latestInboundMessage, memoryEntries);
      } catch (e) {
        this.logger.warn(
          `humanEscalationSummaryFailed ${JSON.stringify({
            conversationId,
            message: e instanceof Error ? e.message : String(e),
          })}`,
        );
        summary = 'The customer requested human assistance.';
      }
    }

    const customerName = crm.displayName?.trim() || 'Unknown customer';
    const phoneForAlert = crm.phone?.trim() || contactPhone?.trim() || null;

    await this.persistPendingInternalAlert(conversationId, {
      latestInboundMessage,
      summary,
      customerName,
      phoneForAlert,
      contactId: contactId?.trim() || null,
    });

    this.logger.log(
      `humanEscalationInternalAlertDeferred ${JSON.stringify({
        conversationId,
        tenantId,
        reason: 'await_outbound_channel',
      })}`,
    );

    return { escalated: true, alreadyInHandover };
  }

  /**
   * Send staged team SMS after customer ack outbound (GHL channel is known).
   * Call from send-bubble worker when draftProvenance is human_escalation.
   */
  async flushPendingInternalAlert(
    tenantId: string,
    conversationId: string,
    channelHint?: OutboundChannel | null,
  ): Promise<'sent' | 'skipped_no_pending' | 'skipped_disabled' | 'skipped_duplicate' | 'failed'> {
    const settings = await this.escalationSettings.getSettings(tenantId);
    if (!settings.enabled || !settings.teamNotificationNumber?.trim()) {
      return 'skipped_disabled';
    }

    const pending = await this.readPendingInternalAlert(conversationId);
    if (!pending) {
      this.logger.log(
        `humanEscalationFlushSkipped ${JSON.stringify({
          conversationId,
          reason: 'no_pending_alert',
        })}`,
      );
      return 'skipped_no_pending';
    }

    const channelSlug = await this.resolveChannelSlugForInternalAlert(
      conversationId,
      tenantId,
      pending.contactId,
      channelHint,
    );

    const customerBlock = formatInternalEscalationCustomerLines({
      customerName: pending.customerName,
      phone: pending.phoneForAlert,
      channelSlug,
    });

    const includeTechnicalFallback =
      pending.customerName === 'Unknown customer' &&
      channelSlug === 'whatsapp' &&
      !(pending.phoneForAlert?.trim());

    const messageBody =
      `Human escalation requested\n\n` +
      `${customerBlock}\n` +
      (includeTechnicalFallback
        ? `Reference (internal): conversation ${conversationId}` +
          (pending.contactId ? `, contact ${pending.contactId}` : '') +
          `\n\n`
        : `\n`) +
      `Summary:\n${pending.summary}\n\n` +
      `Latest message:\n"${pending.latestInboundMessage.trim().slice(0, 2000)}"\n\n` +
      `Please review and reply manually in CRM.`;

    const outcome = await this.notify.sendInternalAlert({
      tenantId,
      enabled: true,
      teamNotificationNumber: settings.teamNotificationNumber,
      optionalMessagePrefix: settings.optionalMessagePrefix,
      messageBody,
      customerPhoneForDuplicateCheck: pending.phoneForAlert,
    });

    await this.clearPendingInternalAlert(conversationId);

    if (outcome === 'sent') {
      await this.persistHumanEscalationAlertSentAt(conversationId);
      this.logger.log(
        `humanEscalationInternalAlertSent ${JSON.stringify({
          conversationId,
          tenantId,
          channelSlug,
        })}`,
      );
      return 'sent';
    }

    return outcome === 'skipped_disabled' ? 'skipped_disabled' : 'failed';
  }

  /**
   * Optional staff reminder while handover is already active (customer continues messaging).
   * Throttling is handled by the caller; this method is best-effort and should not throw.
   */
  async sendInternalUpdateDuringActiveHandover(params: {
    tenantId: string;
    conversationId: string;
    contactId?: string | null;
    latestInboundMessage: string;
    contactPhone?: string | null;
    contactDisplayName?: string | null;
  }): Promise<'sent' | 'skipped_disabled' | 'skipped_no_number' | 'failed' | 'suppressed'> {
    const { tenantId, conversationId, contactId, latestInboundMessage, contactPhone, contactDisplayName } = params;

    const settings = await this.escalationSettings.getSettings(tenantId);
    if (!settings.enabled) return 'skipped_disabled';
    if (!settings.teamNotificationNumber?.trim()) return 'skipped_no_number';

    try {
      const crm = await this.resolveCrmContactForAlert(tenantId, contactId, contactDisplayName, contactPhone);
      const channelSlug = await this.resolveChannelSlugForInternalAlert(
        conversationId,
        tenantId,
        contactId,
        null,
      );
      const customerName = crm.displayName?.trim() || 'Unknown customer';
      const customerBlock = formatInternalEscalationCustomerLines({
        customerName,
        phone: crm.phone?.trim() || contactPhone?.trim() || null,
        channelSlug,
      });

      const messageBody =
        `Human escalation update\n\n` +
        `${customerBlock}\n\n` +
        `Latest message:\n"${latestInboundMessage.trim().slice(0, 2000)}"\n\n` +
        `Customer is still waiting for human assistance.`;

      const outcome = await this.notify.sendInternalAlert({
        tenantId,
        enabled: true,
        teamNotificationNumber: settings.teamNotificationNumber,
        optionalMessagePrefix: settings.optionalMessagePrefix,
        messageBody,
        customerPhoneForDuplicateCheck: contactPhone ?? crm.phone ?? null,
      });

      if (outcome === 'sent') {
        await this.persistHumanEscalationInternalUpdateSentAt(conversationId);
        return 'sent';
      }
      return outcome === 'skipped_disabled' ? 'skipped_disabled' : outcome === 'skipped_no_number' ? 'skipped_no_number' : 'failed';
    } catch (e) {
      this.logger.warn(
        `humanEscalationInternalUpdateFailed ${JSON.stringify({
          conversationId,
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
      return 'failed';
    }
  }

  private async applyAiNeedsHumanReviewTag(tenantId: string, contactId: string | null | undefined): Promise<void> {
    const cid = contactId?.trim();
    if (!cid) {
      this.logger.log(`humanEscalationHumanReviewTagSkipped ${JSON.stringify({ reason: 'no_contact_id' })}`);
      return;
    }
    try {
      const { client } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(tenantId);
      const listed = await client.listTags();
      if (listed.error) {
        this.logger.warn(
          `humanEscalationHumanReviewTagFailed ${JSON.stringify({ reason: 'list_tags', error: listed.error })}`,
        );
        return;
      }
      const approved = new Set(listed.tags.map(t => t.name.trim().toLowerCase()));
      if (!approved.has(AI_NEEDS_HUMAN_REVIEW_TAG.toLowerCase())) {
        this.logger.warn(
          `humanEscalationHumanReviewTagSkipped ${JSON.stringify({
            reason: 'tag_not_in_crm',
            tag: AI_NEEDS_HUMAN_REVIEW_TAG,
          })}`,
        );
        return;
      }
      const res = await client.tagContact({ contactId: cid, tags: [AI_NEEDS_HUMAN_REVIEW_TAG] });
      if (!res.success) {
        this.logger.warn(
          `humanEscalationHumanReviewTagFailed ${JSON.stringify({ reason: 'tag_contact', error: res.error ?? '' })}`,
        );
        return;
      }
      this.logger.log(
        `humanEscalationHumanReviewTagApplied ${JSON.stringify({ tenantId, contactIdPrefix: cid.slice(0, 8) })}`,
      );
    } catch (e) {
      this.logger.warn(
        `humanEscalationHumanReviewTagFailed ${JSON.stringify({
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
    }
  }

  private async resolveCrmContactForAlert(
    tenantId: string,
    contactId: string | null | undefined,
    webhookDisplayName: string | null | undefined,
    webhookPhone: string | null | undefined,
  ): Promise<{
    displayName: string | null;
    phone: string | null;
    contact: Record<string, unknown> | null;
  }> {
    const cid = contactId?.trim();
    if (!cid) {
      return {
        displayName: webhookDisplayName?.trim() || null,
        phone: webhookPhone?.trim() || null,
        contact: null,
      };
    }
    try {
      const { client } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(tenantId);
      const gc = await client.getContact(cid);
      if (!gc.success || !gc.contact) {
        return {
          displayName: webhookDisplayName?.trim() || null,
          phone: webhookPhone?.trim() || null,
          contact: null,
        };
      }
      const c = gc.contact;
      return {
        displayName: pickContactDisplayName(c) || webhookDisplayName?.trim() || null,
        phone: pickContactPhone(c) || webhookPhone?.trim() || null,
        contact: c,
      };
    } catch {
      return {
        displayName: webhookDisplayName?.trim() || null,
        phone: webhookPhone?.trim() || null,
        contact: null,
      };
    }
  }

  private async resolveChannelSlugForInternalAlert(
    conversationId: string,
    tenantId: string,
    contactId: string | null | undefined,
    channelHint: OutboundChannel | null | undefined,
  ): Promise<InternalAlertChannelSlug> {
    if (channelHint) {
      return internalAlertChannelSlugFromOutbound(channelHint);
    }

    let dbChannel: string | null = null;
    let metadata: Record<string, unknown> | null = null;
    let ghlConversationId: string | null = null;

    const { data, error } = await this.supabase
      .from('conversations')
      .select('channel, metadata, ghl_conversation_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!error && data) {
      dbChannel = typeof data.channel === 'string' ? data.channel : null;
      ghlConversationId =
        typeof data.ghl_conversation_id === 'string' ? data.ghl_conversation_id : null;
      metadata =
        data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
          ? (data.metadata as Record<string, unknown>)
          : null;
    }

    const metaOutbound = metadata?.['ghlOutboundChannel'];
    if (typeof metaOutbound === 'string' && metaOutbound.trim()) {
      return internalAlertChannelSlugFromOutbound(metaOutbound);
    }

    let contactRecord: Record<string, unknown> | null = null;
    if (contactId?.trim()) {
      const crm = await this.resolveCrmContactForAlert(tenantId, contactId, null, null);
      contactRecord = crm.contact;
    }

    const channelLabel = formatHandoverChannelLabel({
      dbChannel,
      metadata,
      ghlConversationId,
      contact: contactRecord,
    });
    return internalAlertChannelSlugFromLabel(channelLabel);
  }

  private async persistPendingInternalAlert(
    conversationId: string,
    pending: PendingHumanEscalationInternalAlert,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data) return;
    const prev =
      data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};
    const merged = {
      ...prev,
      humanEscalationPendingInternalAlert: pending,
    };
    const { error: upErr } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (upErr) {
      this.logger.warn(
        `humanEscalationPendingAlertPersistFailed ${JSON.stringify({
          conversationId,
          message: formatPostgrestError(upErr),
        })}`,
      );
    }
  }

  private async readPendingInternalAlert(
    conversationId: string,
  ): Promise<PendingHumanEscalationInternalAlert | null> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data?.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
      return null;
    }
    const raw = (data.metadata as Record<string, unknown>)['humanEscalationPendingInternalAlert'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const latestInboundMessage =
      typeof o['latestInboundMessage'] === 'string' ? o['latestInboundMessage'] : '';
    const summary = typeof o['summary'] === 'string' ? o['summary'] : '';
    if (!latestInboundMessage.trim() || !summary.trim()) return null;
    return {
      latestInboundMessage,
      summary,
      customerName:
        typeof o['customerName'] === 'string' && o['customerName'].trim()
          ? o['customerName'].trim()
          : 'Unknown customer',
      phoneForAlert:
        typeof o['phoneForAlert'] === 'string' && o['phoneForAlert'].trim()
          ? o['phoneForAlert'].trim()
          : null,
      contactId:
        typeof o['contactId'] === 'string' && o['contactId'].trim() ? o['contactId'].trim() : null,
    };
  }

  private async clearPendingInternalAlert(conversationId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data) return;
    const prev =
      data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};
    const { humanEscalationPendingInternalAlert: _removed, ...rest } = prev;
    const { error: upErr } = await this.supabase
      .from('conversations')
      .update({ metadata: rest, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (upErr) {
      this.logger.warn(
        `humanEscalationPendingAlertClearFailed ${JSON.stringify({
          conversationId,
          message: formatPostgrestError(upErr),
        })}`,
      );
    }
  }

  private async tryAiInternalSummary(
    tenantId: string,
    latestInboundMessage: string,
    memoryEntries: MemoryEntry[],
  ): Promise<string | null> {
    const recent = memoryEntries
      .filter(m => m.role === 'user')
      .map(m => String(m.content ?? '').trim())
      .filter(Boolean)
      .slice(-4);
    const contextBlock = [...recent, latestInboundMessage.trim()].filter(Boolean).join('\n');
    if (!contextBlock.trim()) return null;

    const incomingMessage =
      `Write exactly ONE short sentence (max 28 words) in plain English summarizing what the customer wants, ` +
      `for an internal staff alert. Do not quote the customer. Do not list IDs.\n` +
      `Conversation lines:\n${contextBlock.slice(0, 1200)}`;

    try {
      const gen = await this.generation.generateDraft({
        tenantId,
        incomingMessage,
        systemPrompt:
          'You write internal CRM summaries for staff only. Output a single factual sentence. No bullet points.',
        memory: [],
        kbContext: [],
        temperature: 0.2,
        maxTokens: 90,
      });
      const raw = gen.content?.trim().replace(/\s+/g, ' ');
      if (!raw) return null;
      const one = raw.split(/(?<=[.!?])\s+/)[0]?.trim() ?? raw;
      return one.length > 220 ? `${one.slice(0, 217)}…` : one;
    } catch (e) {
      this.logger.warn(
        `humanEscalationAiSummaryFailed ${JSON.stringify({
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
      return null;
    }
  }

  private async readHumanEscalationAlertSentAt(conversationId: string): Promise<string | null> {
    const { data, error } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    if (error || !data?.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) return null;
    const v = (data.metadata as Record<string, unknown>)['humanEscalationInternalAlertSentAt'];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  private async persistHumanEscalationAlertSentAt(conversationId: string): Promise<void> {
    const { data, error } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    if (error || !data) return;
    const prev =
      data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};
    const merged = {
      ...prev,
      humanEscalationInternalAlertSentAt: new Date().toISOString(),
    };
    const { error: upErr } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (upErr) {
      this.logger.warn(
        `humanEscalationMetadataPersistFailed ${JSON.stringify({
          conversationId,
          message: formatPostgrestError(upErr),
        })}`,
      );
    }
  }

  private async persistHumanEscalationInternalUpdateSentAt(conversationId: string): Promise<void> {
    const { data, error } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    if (error || !data) return;
    const prev =
      data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {};
    const merged = {
      ...prev,
      humanEscalationLastInternalUpdateSentAt: new Date().toISOString(),
    };
    const { error: upErr } = await this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (upErr) {
      this.logger.warn(
        `humanEscalationMetadataPersistFailed ${JSON.stringify({
          conversationId,
          message: formatPostgrestError(upErr),
        })}`,
      );
    }
  }
}
