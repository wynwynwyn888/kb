import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { buildDeterministicHumanEscalationSummary } from '../../lib/human-escalation-summary';
import type { MemoryEntry } from '../orchestration/dto/memory-entry';
import { ConversationsService } from '../conversations/conversations.service';
import { FollowUpEngineService } from '../follow-up-engine/follow-up-engine.service';
import { HumanEscalationSettingsService } from './human-escalation-settings.service';
import { HumanEscalationNotifyService } from './human-escalation-notify.service';

const HUMAN_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class HumanEscalationRuntimeService {
  private readonly logger = new Logger(HumanEscalationRuntimeService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly conversations: ConversationsService,
    private readonly followUpEngine: FollowUpEngineService,
    private readonly escalationSettings: HumanEscalationSettingsService,
    private readonly notify: HumanEscalationNotifyService,
  ) {}

  /**
   * Idempotent side effects for deterministic HUMAN_HANDOVER intent: handover row, cancel follow-ups, optional team SMS.
   */
  async onHumanHandoverIntent(params: {
    tenantId: string;
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
      tenantDisplayName,
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

    let summary: string;
    try {
      summary = buildDeterministicHumanEscalationSummary(latestInboundMessage, memoryEntries);
    } catch (e) {
      this.logger.warn(
        `humanEscalationSummaryFailed ${JSON.stringify({
          conversationId,
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
      summary = latestInboundMessage.trim().slice(0, 400) || 'Customer requested human assistance.';
    }

    const customerLabel =
      (contactDisplayName?.trim() && contactDisplayName.trim()) ||
      (contactPhone?.trim() && contactPhone.trim()) ||
      (contactId?.trim() && `contact ${contactId.trim()}`) ||
      'Unknown';

    const workspaceLine = tenantDisplayName?.trim()
      ? `Workspace: ${tenantDisplayName.trim()}`
      : `Workspace tenant: ${tenantId}`;

    const messageBody =
      `Human escalation requested\n\n` +
      `${workspaceLine}\n` +
      `Customer: ${customerLabel}\n` +
      `Conversation: ${conversationId}\n` +
      (contactId?.trim() ? `Contact: ${contactId.trim()}\n` : '') +
      `\nSummary:\n${summary}\n\n` +
      `Latest message:\n"${latestInboundMessage.trim().slice(0, 2000)}"\n\n` +
      `Please review and reply manually in GHL.`;

    const outcome = await this.notify.sendInternalAlert({
      tenantId,
      enabled: true,
      teamNotificationNumber: settings.teamNotificationNumber,
      optionalMessagePrefix: settings.optionalMessagePrefix,
      messageBody,
      customerPhoneForDuplicateCheck: contactPhone ?? null,
    });

    if (outcome === 'sent') {
      await this.persistHumanEscalationAlertSentAt(conversationId);
    }

    return { alreadyInHandover };
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
