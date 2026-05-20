import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createGhlClient } from '@aisbp/ghl-client';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt } from '../../lib/encryption';
import { formatResetDateForMessage } from '../credit-warnings/credit-warnings.copy';
import {
  ALL_CREDIT_RESET_REMINDER_DAYS,
  DEFAULT_CREDIT_RESET_REMINDER_DAYS,
  DEFAULT_CREDIT_RESET_REMINDER_MESSAGE_TEMPLATE,
} from './credit-reset-reminders.constants';
import {
  daysUntilResetDate,
  renderResetReminderMessage,
  sanitizeReminderDaysArray,
} from './credit-reset-reminders.copy';

export interface AgencyCreditResetReminderSettings {
  enabled: boolean;
  daysBefore: number[];
  messageTemplate: string;
  sendViaAgencyWorkspace: boolean;
}

export interface SaveAgencyCreditResetReminderSettingsInput {
  enabled?: boolean;
  daysBefore?: number[];
  messageTemplate?: string;
  sendViaAgencyWorkspace?: boolean;
}

@Injectable()
export class CreditResetRemindersService {
  private readonly logger = new Logger(CreditResetRemindersService.name);
  private readonly supabase = getSupabaseService();

  async getAgencySettings(agencyId: string): Promise<AgencyCreditResetReminderSettings> {
    const { data, error } = await this.supabase
      .from('agencies')
      .select(
        'credit_reset_reminder_enabled, credit_reset_reminder_days_json, credit_reset_reminder_message_template, credit_reset_reminder_send_via_agency_workspace',
      )
      .eq('id', agencyId)
      .maybeSingle();
    if (error) {
      this.logger.warn(`getAgencySettings read failed agency=${agencyId} ${error.message}`);
    }
    const row = (data ?? {}) as {
      credit_reset_reminder_enabled?: boolean;
      credit_reset_reminder_days_json?: unknown;
      credit_reset_reminder_message_template?: string;
      credit_reset_reminder_send_via_agency_workspace?: boolean;
    };
    const days = sanitizeReminderDaysArray(row.credit_reset_reminder_days_json);
    return {
      enabled: Boolean(row.credit_reset_reminder_enabled),
      daysBefore: days.length > 0 ? days : [...DEFAULT_CREDIT_RESET_REMINDER_DAYS],
      messageTemplate:
        typeof row.credit_reset_reminder_message_template === 'string' &&
        row.credit_reset_reminder_message_template.trim().length > 0
          ? row.credit_reset_reminder_message_template
          : DEFAULT_CREDIT_RESET_REMINDER_MESSAGE_TEMPLATE,
      sendViaAgencyWorkspace:
        row.credit_reset_reminder_send_via_agency_workspace === undefined
          ? true
          : Boolean(row.credit_reset_reminder_send_via_agency_workspace),
    };
  }

  async saveAgencySettings(
    agencyId: string,
    patch: SaveAgencyCreditResetReminderSettingsInput,
  ): Promise<AgencyCreditResetReminderSettings> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.enabled !== undefined) update['credit_reset_reminder_enabled'] = Boolean(patch.enabled);
    if (patch.daysBefore !== undefined) {
      update['credit_reset_reminder_days_json'] = sanitizeReminderDaysArray(patch.daysBefore);
    }
    if (patch.messageTemplate !== undefined) {
      const t = typeof patch.messageTemplate === 'string' ? patch.messageTemplate : '';
      update['credit_reset_reminder_message_template'] = t.length > 4000 ? t.slice(0, 4000) : t;
    }
    if (patch.sendViaAgencyWorkspace !== undefined) {
      update['credit_reset_reminder_send_via_agency_workspace'] = Boolean(patch.sendViaAgencyWorkspace);
    }
    const { error } = await this.supabase.from('agencies').update(update).eq('id', agencyId);
    if (error) throw new Error(error.message);
    return this.getAgencySettings(agencyId);
  }

  /** Fire-and-forget entry: scan wallets for this agency and send due reminders. Never throws. */
  processAgencyReminders(agencyId: string): void {
    void this.runProcessAgencyReminders(agencyId).catch(e => {
      this.logger.warn(
        `processAgencyReminders failed agency=${agencyId} ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  }

  private async runProcessAgencyReminders(agencyId: string): Promise<void> {
    const settings = await this.getAgencySettings(agencyId);
    if (!settings.enabled || settings.daysBefore.length === 0) return;
    if (!settings.sendViaAgencyWorkspace) return;

    const crm = await this.loadAgencySystemWorkspaceCrm(agencyId);
    if (crm === 'missing_workspace' || crm === 'not_connected') return;

    const { data: tenants } = await this.supabase
      .from('tenants')
      .select('id, name, is_agency_workspace, credits_unlimited, client_contact_phone, client_contact_name')
      .eq('agency_id', agencyId)
      .eq('is_agency_workspace', false)
      .eq('credits_unlimited', false);
    const tlist = tenants ?? [];
    if (tlist.length === 0) return;

    const ids = tlist.map(t => (t as { id: string }).id);
    const { data: wallets } = await this.supabase
      .from('quota_wallets')
      .select('tenant_id, total_quota, used_quota, period_start, period_end')
      .in('tenant_id', ids);
    const wmap = new Map((wallets ?? []).map(w => [(w as { tenant_id: string }).tenant_id, w]));

    const { data: agencyRow } = await this.supabase.from('agencies').select('name').eq('id', agencyId).maybeSingle();
    const agencyName = String((agencyRow as { name?: string } | null)?.name ?? '');

    const enabledDays = new Set(settings.daysBefore);
    const ghlClient = createGhlClient(crm.decryptedToken, crm.ghlLocationId);

    for (const t of tlist) {
      const row = t as {
        id: string;
        name: string;
        client_contact_phone?: string | null;
        client_contact_name?: string | null;
      };
      const wallet = wmap.get(row.id);
      if (!wallet) continue;
      const periodEnd = (wallet as { period_end?: string | null }).period_end ?? null;
      const daysLeft = daysUntilResetDate(periodEnd);
      if (daysLeft == null || !enabledDays.has(daysLeft)) continue;

      if (await this.alreadySent(row.id, daysLeft, periodEnd)) continue;

      const phone = (row.client_contact_phone ?? '').trim();
      if (!phone) {
        await this.recordEvent({
          agencyId,
          tenantId: row.id,
          daysBefore: daysLeft,
          balanceAtSend: this.balance(wallet),
          status: 'SKIPPED',
          reason: 'client_phone_missing',
          messagePreview: null,
          billingPeriodStart: (wallet as { period_start?: string }).period_start ?? null,
          billingPeriodEnd: periodEnd,
        });
        continue;
      }

      const rendered = renderResetReminderMessage(settings.messageTemplate, {
        clientName: row.client_contact_name,
        workspaceName: row.name,
        remainingCredits: this.balance(wallet),
        agencyName,
        resetDate: formatResetDateForMessage(periodEnd),
        daysBefore: daysLeft,
      });
      const messagePreview = rendered.length > 500 ? rendered.slice(0, 500) : rendered;

      let contactId: string | null = null;
      try {
        const lookup = await ghlClient.findContactByPhone(crm.ghlLocationId, phone);
        if (lookup.success && lookup.contact?.id) {
          contactId = lookup.contact.id;
        } else {
          const created = await ghlClient.createContact({
            phone,
            firstName: row.client_contact_name?.trim() || 'Client',
          });
          if (created.success && created.contactId) contactId = created.contactId;
        }
      } catch (e) {
        this.logger.warn(
          `resetReminder contact lookup failed tenant=${row.id} ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!contactId) {
        await this.recordEvent({
          agencyId,
          tenantId: row.id,
          daysBefore: daysLeft,
          balanceAtSend: this.balance(wallet),
          status: 'FAILED',
          reason: 'send_failed_no_contact',
          messagePreview,
          billingPeriodStart: (wallet as { period_start?: string }).period_start ?? null,
          billingPeriodEnd: periodEnd,
        });
        continue;
      }

      const { eventId, alreadyExists } = await this.reserveSentEvent({
        agencyId,
        tenantId: row.id,
        daysBefore: daysLeft,
        balanceAtSend: this.balance(wallet),
        messagePreview,
        billingPeriodStart: (wallet as { period_start?: string }).period_start ?? null,
        billingPeriodEnd: periodEnd,
      });
      if (alreadyExists) continue;

      try {
        const send = await ghlClient.sendMessage({
          locationId: crm.ghlLocationId,
          contactId,
          message: rendered,
          channel: 'SMS',
        });
        if (!send.success) {
          await this.markEventFailed(eventId, send.error || 'send_failed_provider');
        }
      } catch (e) {
        await this.markEventFailed(eventId, e instanceof Error ? e.message : 'send_failed_unknown');
      }
    }
  }

  private balance(wallet: { total_quota?: number; used_quota?: number }): number {
    const total = wallet.total_quota ?? 0;
    const used = wallet.used_quota ?? 0;
    return total - used;
  }

  private async loadAgencySystemWorkspaceCrm(
    agencyId: string,
  ): Promise<
    | { tenantId: string; ghlLocationId: string; decryptedToken: string }
    | 'missing_workspace'
    | 'not_connected'
  > {
    const { data: ws } = await this.supabase
      .from('tenants')
      .select('id, ghl_location_id')
      .eq('agency_id', agencyId)
      .eq('is_agency_workspace', true)
      .maybeSingle();
    if (!ws) return 'missing_workspace';
    const wsRow = ws as { id: string; ghl_location_id?: string | null };
    const ghlLocationId = (wsRow.ghl_location_id ?? '').trim();
    if (!ghlLocationId || ghlLocationId.startsWith('pending:')) return 'not_connected';

    const { data: conn } = await this.supabase
      .from('tenant_ghl_connections')
      .select('private_token_encrypted, status')
      .eq('tenant_id', wsRow.id)
      .eq('status', 'CONNECTED')
      .maybeSingle();
    if (!conn) return 'not_connected';
    try {
      const token = decrypt(String((conn as { private_token_encrypted?: string }).private_token_encrypted ?? ''));
      if (!token) return 'not_connected';
      return { tenantId: wsRow.id, ghlLocationId, decryptedToken: token };
    } catch {
      return 'not_connected';
    }
  }

  private async alreadySent(tenantId: string, daysBefore: number, periodEnd: string | null): Promise<boolean> {
    let q = this.supabase
      .from('workspace_credit_reset_reminder_events')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('days_before_reset', daysBefore)
      .eq('status', 'SENT')
      .limit(1);
    q = periodEnd ? q.eq('billing_period_end', periodEnd) : q.is('billing_period_end', null);
    const { data } = await q.maybeSingle();
    return Boolean(data);
  }

  private async reserveSentEvent(params: {
    agencyId: string;
    tenantId: string;
    daysBefore: number;
    balanceAtSend: number;
    messagePreview: string;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
  }): Promise<{ eventId: string; alreadyExists: boolean }> {
    const id = randomUUID();
    const { error } = await this.supabase.from('workspace_credit_reset_reminder_events').insert({
      id,
      agency_id: params.agencyId,
      tenant_id: params.tenantId,
      days_before_reset: params.daysBefore,
      balance_at_send: params.balanceAtSend,
      status: 'SENT',
      reason: null,
      message_preview: params.messagePreview,
      billing_period_start: params.billingPeriodStart,
      billing_period_end: params.billingPeriodEnd,
    });
    if (!error) return { eventId: id, alreadyExists: false };
    const code = (error as { code?: string }).code;
    if (code === '23505' || /duplicate|unique/i.test(error.message ?? '')) {
      return { eventId: id, alreadyExists: true };
    }
    throw new Error(error.message);
  }

  private async markEventFailed(eventId: string, reason: string): Promise<void> {
    const trimmed = reason.length > 200 ? reason.slice(0, 200) : reason;
    await this.supabase
      .from('workspace_credit_reset_reminder_events')
      .update({ status: 'FAILED', reason: trimmed })
      .eq('id', eventId);
  }

  private async recordEvent(params: {
    agencyId: string;
    tenantId: string;
    daysBefore: number;
    balanceAtSend: number;
    status: 'SKIPPED' | 'FAILED';
    reason: string | null;
    messagePreview: string | null;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
  }): Promise<void> {
    await this.supabase.from('workspace_credit_reset_reminder_events').insert({
      id: randomUUID(),
      agency_id: params.agencyId,
      tenant_id: params.tenantId,
      days_before_reset: params.daysBefore,
      balance_at_send: params.balanceAtSend,
      status: params.status,
      reason: params.reason,
      message_preview: params.messagePreview,
      billing_period_start: params.billingPeriodStart,
      billing_period_end: params.billingPeriodEnd,
    });
  }
}

export { ALL_CREDIT_RESET_REMINDER_DAYS };
