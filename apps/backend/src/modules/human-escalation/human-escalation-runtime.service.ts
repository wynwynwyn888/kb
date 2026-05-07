import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { buildReadableFallbackInternalSummary } from '../../lib/human-escalation-summary';
import type { MemoryEntry } from '../orchestration/dto/memory-entry';
import { ConversationsService } from '../conversations/conversations.service';
import { FollowUpEngineService } from '../follow-up-engine/follow-up-engine.service';
import { HumanEscalationSettingsService } from './human-escalation-settings.service';
import { HumanEscalationNotifyService } from './human-escalation-notify.service';
import { GhlService } from '../ghl/ghl.service';
import { GenerationService } from '../generation/generation.service';

const HUMAN_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const AI_NEEDS_HUMAN_REVIEW_TAG = 'ai_needs_human_review';

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
  }): Promise<{ alreadyInHandover: boolean }> {
    const {
      tenantId,
      conversationId,
      contactId,
      latestInboundMessage,
      memoryEntries,
      contactPhone,
      contactDisplayName,
    } = params;

    this.logger.log(
      `humanEscalationDetected ${JSON.stringify({
        tenantId,
        conversationId,
        contactId: contactId ?? null,
      })}`,
    );

    const alreadyInHandover = await this.conversations.isInHandover(conversationId);
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

    const settings = await this.escalationSettings.getSettings(tenantId);

    if (!settings.enabled) {
      this.logger.log(`humanEscalationNotifySkipped ${JSON.stringify({ reason: 'human_escalation_disabled' })}`);
      return { alreadyInHandover };
    }

    const rawNum = settings.teamNotificationNumber?.trim();
    if (!rawNum) {
      this.logger.log(`humanEscalationSettingsMissing ${JSON.stringify({ reason: 'no_team_notification_number' })}`);
      return { alreadyInHandover };
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
      return { alreadyInHandover };
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
    const phoneLine = crm.phone?.trim() || contactPhone?.trim() || 'Unknown phone';

    const includeTechnicalFallback = customerName === 'Unknown customer' && phoneLine === 'Unknown phone';

    const messageBody =
      `Human escalation requested\n\n` +
      `Customer: ${customerName}\n` +
      `Phone: ${phoneLine}\n` +
      (includeTechnicalFallback
        ? `Reference (internal): conversation ${conversationId}` +
          (contactId?.trim() ? `, contact ${contactId.trim()}` : '') +
          `\n\n`
        : `\n`) +
      `Summary:\n${summary}\n\n` +
      `Latest message:\n"${latestInboundMessage.trim().slice(0, 2000)}"\n\n` +
      `Please review and reply manually in GHL.`;

    const outcome = await this.notify.sendInternalAlert({
      tenantId,
      enabled: true,
      teamNotificationNumber: settings.teamNotificationNumber,
      optionalMessagePrefix: settings.optionalMessagePrefix,
      messageBody,
      customerPhoneForDuplicateCheck: contactPhone ?? crm.phone ?? null,
    });

    if (outcome === 'sent') {
      await this.persistHumanEscalationAlertSentAt(conversationId);
    }

    return { alreadyInHandover };
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
  ): Promise<{ displayName: string | null; phone: string | null }> {
    const cid = contactId?.trim();
    if (!cid) {
      return {
        displayName: webhookDisplayName?.trim() || null,
        phone: webhookPhone?.trim() || null,
      };
    }
    try {
      const { client } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(tenantId);
      const gc = await client.getContact(cid);
      if (!gc.success || !gc.contact) {
        return {
          displayName: webhookDisplayName?.trim() || null,
          phone: webhookPhone?.trim() || null,
        };
      }
      const c = gc.contact;
      return {
        displayName: pickContactDisplayName(c) || webhookDisplayName?.trim() || null,
        phone: pickContactPhone(c) || webhookPhone?.trim() || null,
      };
    } catch {
      return {
        displayName: webhookDisplayName?.trim() || null,
        phone: webhookPhone?.trim() || null,
      };
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
}
