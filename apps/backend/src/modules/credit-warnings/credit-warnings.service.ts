// Low-credit warning automation:
//  - Read / save agency-configurable warning settings (thresholds, message template, send toggle).
//  - Decide which threshold a successful credit debit just crossed.
//  - Send the warning via the agency system workspace CRM connection (SMS, GHL Private Integration).
//  - Persist a `workspace_credit_warning_events` row for SENT / SKIPPED / FAILED outcomes.
//
// Idempotency: a partial unique index prevents duplicate SENT rows for the same
// (workspace, threshold, billing_period_end) — the agency only ever sees one warning per
// threshold per billing period, even if many debits land near the boundary.

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createGhlClient } from '@aisbp/ghl-client';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt } from '../../lib/encryption';
import {
  ALL_LOW_CREDIT_WARNING_THRESHOLDS,
  DEFAULT_LOW_CREDIT_WARNING_MESSAGE_TEMPLATE,
  DEFAULT_LOW_CREDIT_WARNING_THRESHOLDS,
  type LowCreditWarningSkipReason,
} from './credit-warnings.constants';
import {
  formatResetDateForMessage,
  renderWarningMessage,
  sanitizeThresholdsArray,
  selectCrossedThreshold,
} from './credit-warnings.copy';

export interface AgencyLowCreditWarningSettings {
  enabled: boolean;
  thresholds: number[];
  messageTemplate: string;
  sendViaAgencyWorkspace: boolean;
}

export interface SaveAgencyLowCreditWarningSettingsInput {
  enabled?: boolean;
  thresholds?: number[];
  messageTemplate?: string;
  sendViaAgencyWorkspace?: boolean;
}

export interface PostDebitWarningInput {
  /** Tenant whose wallet was just debited successfully. */
  tenantId: string;
  /** Wallet balance before the debit (used for crossing detection). */
  balanceBefore: number;
  /** Wallet balance after the debit (used for crossing detection + SMS body). */
  balanceAfter: number;
  /** ISO timestamps from `quota_wallets`; both are optional but the SENT-uniqueness key uses periodEnd. */
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Optional override of the trigger reason for logs. */
  triggerSource?: 'reply_debit' | 'manual';
}

export type PostDebitWarningResult =
  | { status: 'SENT'; threshold: number; eventId: string }
  | { status: 'SKIPPED'; threshold: number | null; reason: LowCreditWarningSkipReason; eventId?: string }
  | { status: 'FAILED'; threshold: number; reason: string; eventId: string };

interface AgencyContext {
  agencyId: string;
  agencyName: string;
  enabled: boolean;
  thresholds: number[];
  messageTemplate: string;
  sendViaAgencyWorkspace: boolean;
}

interface TenantContext {
  tenantId: string;
  workspaceName: string;
  isAgencyWorkspace: boolean;
  creditsUnlimited: boolean;
  agencyId: string;
  clientPhone: string | null;
  clientName: string | null;
}

interface AgencySystemWorkspaceCrm {
  tenantId: string;
  ghlLocationId: string;
  decryptedToken: string;
}

@Injectable()
export class CreditWarningsService {
  private readonly logger = new Logger(CreditWarningsService.name);
  private readonly supabase = getSupabaseService();

  // ---------------------------------------------------------------------------
  // Settings (read / save)
  // ---------------------------------------------------------------------------

  async getAgencyLowCreditWarningSettings(agencyId: string): Promise<AgencyLowCreditWarningSettings> {
    const { data, error } = await this.supabase
      .from('agencies')
      .select(
        'default_low_credit_warning_enabled, low_credit_warning_thresholds_json, low_credit_warning_message_template, low_credit_warning_send_via_agency_workspace',
      )
      .eq('id', agencyId)
      .maybeSingle();
    if (error) {
      this.logger.warn(`getAgencyLowCreditWarningSettings read failed agency=${agencyId} ${error.message}`);
    }
    const row = (data ?? {}) as {
      default_low_credit_warning_enabled?: boolean;
      low_credit_warning_thresholds_json?: unknown;
      low_credit_warning_message_template?: string;
      low_credit_warning_send_via_agency_workspace?: boolean;
    };
    const sanitized = sanitizeThresholdsArray(row.low_credit_warning_thresholds_json);
    return {
      enabled: Boolean(row.default_low_credit_warning_enabled),
      thresholds: sanitized.length > 0 ? sanitized : [...DEFAULT_LOW_CREDIT_WARNING_THRESHOLDS],
      messageTemplate:
        typeof row.low_credit_warning_message_template === 'string' && row.low_credit_warning_message_template.trim().length > 0
          ? row.low_credit_warning_message_template
          : DEFAULT_LOW_CREDIT_WARNING_MESSAGE_TEMPLATE,
      sendViaAgencyWorkspace:
        row.low_credit_warning_send_via_agency_workspace === undefined
          ? true
          : Boolean(row.low_credit_warning_send_via_agency_workspace),
    };
  }

  async saveAgencyLowCreditWarningSettings(
    agencyId: string,
    patch: SaveAgencyLowCreditWarningSettingsInput,
  ): Promise<AgencyLowCreditWarningSettings> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.enabled !== undefined) update['default_low_credit_warning_enabled'] = Boolean(patch.enabled);
    if (patch.thresholds !== undefined) {
      const filtered = sanitizeThresholdsArray(patch.thresholds);
      update['low_credit_warning_thresholds_json'] = filtered;
    }
    if (patch.messageTemplate !== undefined) {
      const t = typeof patch.messageTemplate === 'string' ? patch.messageTemplate : '';
      update['low_credit_warning_message_template'] = t.length > 4000 ? t.slice(0, 4000) : t;
    }
    if (patch.sendViaAgencyWorkspace !== undefined) {
      update['low_credit_warning_send_via_agency_workspace'] = Boolean(patch.sendViaAgencyWorkspace);
    }

    const { error } = await this.supabase.from('agencies').update(update).eq('id', agencyId);
    if (error) {
      this.logger.error(`saveAgencyLowCreditWarningSettings failed agency=${agencyId} ${error.message}`);
      throw new Error(error.message);
    }
    return this.getAgencyLowCreditWarningSettings(agencyId);
  }

  // ---------------------------------------------------------------------------
  // Trigger after successful credit debit
  // ---------------------------------------------------------------------------

  /**
   * Post-debit hook. Decides whether a single warning should be sent and, if so, sends it
   * synchronously through the agency workspace CRM connection. Always returns a structured
   * result; never throws — the credit debit must not be rolled back if the warning fails.
   */
  async maybeSendForCreditDebit(input: PostDebitWarningInput): Promise<PostDebitWarningResult> {
    try {
      return await this.runMaybeSend(input);
    } catch (e) {
      this.logger.error(
        `lowCreditWarning unexpected error tenant=${input.tenantId} ${e instanceof Error ? e.message : String(e)}`,
      );
      return { status: 'SKIPPED', threshold: null, reason: 'send_failed_unknown' as never };
    }
  }

  private async runMaybeSend(input: PostDebitWarningInput): Promise<PostDebitWarningResult> {
    const tenant = await this.loadTenantContext(input.tenantId);
    if (!tenant) {
      return { status: 'SKIPPED', threshold: null, reason: 'no_threshold_crossed' };
    }

    if (tenant.isAgencyWorkspace) {
      return { status: 'SKIPPED', threshold: null, reason: 'is_agency_workspace' };
    }
    if (tenant.creditsUnlimited) {
      return { status: 'SKIPPED', threshold: null, reason: 'unlimited_credits' };
    }

    const agency = await this.loadAgencyContext(tenant.agencyId);
    if (!agency.enabled) {
      return { status: 'SKIPPED', threshold: null, reason: 'warnings_disabled' };
    }
    if (agency.thresholds.length === 0) {
      return { status: 'SKIPPED', threshold: null, reason: 'no_thresholds_configured' };
    }
    if (!agency.sendViaAgencyWorkspace) {
      return { status: 'SKIPPED', threshold: null, reason: 'agency_workspace_send_disabled' };
    }

    const threshold = selectCrossedThreshold({
      balanceBefore: input.balanceBefore,
      balanceAfter: input.balanceAfter,
      enabledThresholds: agency.thresholds,
    });
    if (threshold == null) {
      return { status: 'SKIPPED', threshold: null, reason: 'no_threshold_crossed' };
    }

    // Already sent for this billing period?
    if (await this.alreadySentForPeriod(tenant.tenantId, threshold, input.periodEnd ?? null)) {
      return {
        status: 'SKIPPED',
        threshold,
        reason: 'threshold_already_sent_for_period',
      };
    }

    if (!tenant.clientPhone) {
      const eventId = await this.recordEvent({
        agencyId: tenant.agencyId,
        tenantId: tenant.tenantId,
        threshold,
        balanceAtSend: input.balanceAfter,
        status: 'SKIPPED',
        reason: 'client_phone_missing',
        messagePreview: null,
        billingPeriodStart: input.periodStart ?? null,
        billingPeriodEnd: input.periodEnd ?? null,
      });
      return { status: 'SKIPPED', threshold, reason: 'client_phone_missing', eventId };
    }

    const crm = await this.loadAgencySystemWorkspaceCrm(tenant.agencyId);
    if (crm === 'missing_workspace') {
      const eventId = await this.recordEvent({
        agencyId: tenant.agencyId,
        tenantId: tenant.tenantId,
        threshold,
        balanceAtSend: input.balanceAfter,
        status: 'SKIPPED',
        reason: 'agency_system_workspace_missing',
        messagePreview: null,
        billingPeriodStart: input.periodStart ?? null,
        billingPeriodEnd: input.periodEnd ?? null,
      });
      return { status: 'SKIPPED', threshold, reason: 'agency_system_workspace_missing', eventId };
    }
    if (crm === 'not_connected') {
      const eventId = await this.recordEvent({
        agencyId: tenant.agencyId,
        tenantId: tenant.tenantId,
        threshold,
        balanceAtSend: input.balanceAfter,
        status: 'SKIPPED',
        reason: 'agency_workspace_crm_not_connected',
        messagePreview: null,
        billingPeriodStart: input.periodStart ?? null,
        billingPeriodEnd: input.periodEnd ?? null,
      });
      return { status: 'SKIPPED', threshold, reason: 'agency_workspace_crm_not_connected', eventId };
    }

    // Render message
    const renderedMessage = renderWarningMessage(agency.messageTemplate || DEFAULT_LOW_CREDIT_WARNING_MESSAGE_TEMPLATE, {
      clientName: tenant.clientName,
      workspaceName: tenant.workspaceName,
      remainingCredits: input.balanceAfter,
      threshold,
      agencyName: agency.agencyName,
      resetDate: formatResetDateForMessage(input.periodEnd ?? null),
    });
    const messagePreview = renderedMessage.length > 500 ? renderedMessage.slice(0, 500) : renderedMessage;

    // Find the agency workspace's view of this client phone in their CRM (createContact if missing).
    const ghlClient = createGhlClient(crm.decryptedToken, crm.ghlLocationId);
    let contactId: string | null = null;
    try {
      const lookup = await ghlClient.findContactByPhone(crm.ghlLocationId, tenant.clientPhone);
      if (lookup.success && lookup.contact?.id) {
        contactId = lookup.contact.id;
      } else {
        const created = await ghlClient.createContact({ phone: tenant.clientPhone, firstName: tenant.clientName ?? 'Client' });
        if (created.success && created.contactId) {
          contactId = created.contactId;
        }
      }
    } catch (e) {
      this.logger.warn(
        `lowCreditWarning contact lookup/create failed tenant=${tenant.tenantId} ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!contactId) {
      const eventId = await this.recordEvent({
        agencyId: tenant.agencyId,
        tenantId: tenant.tenantId,
        threshold,
        balanceAtSend: input.balanceAfter,
        status: 'FAILED',
        reason: 'send_failed_no_contact',
        messagePreview,
        billingPeriodStart: input.periodStart ?? null,
        billingPeriodEnd: input.periodEnd ?? null,
      });
      return { status: 'FAILED', threshold, reason: 'send_failed_no_contact', eventId: eventId ?? '' };
    }

    // Reserve the SENT row first (idempotent insert) so concurrent debits don't double-send.
    const { eventId, alreadyExists } = await this.reserveSentEvent({
      agencyId: tenant.agencyId,
      tenantId: tenant.tenantId,
      threshold,
      balanceAtSend: input.balanceAfter,
      messagePreview,
      billingPeriodStart: input.periodStart ?? null,
      billingPeriodEnd: input.periodEnd ?? null,
    });
    if (alreadyExists) {
      return { status: 'SKIPPED', threshold, reason: 'threshold_already_sent_for_period' };
    }

    // Now send. If send fails, mark the reserved row FAILED so future debits can retry.
    try {
      const send = await ghlClient.sendMessage({
        locationId: crm.ghlLocationId,
        contactId,
        message: renderedMessage,
        channel: 'SMS',
      });
      if (!send.success) {
        await this.markEventFailed(eventId, send.error || 'send_failed_provider');
        return {
          status: 'FAILED',
          threshold,
          reason: send.error || 'send_failed_provider',
          eventId,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'send_failed_unknown';
      await this.markEventFailed(eventId, msg);
      return { status: 'FAILED', threshold, reason: msg, eventId };
    }

    return { status: 'SENT', threshold, eventId };
  }

  // ---------------------------------------------------------------------------
  // Internal queries
  // ---------------------------------------------------------------------------

  private async loadTenantContext(tenantId: string): Promise<TenantContext | null> {
    const { data } = await this.supabase
      .from('tenants')
      .select(
        'id, agency_id, name, is_agency_workspace, credits_unlimited, client_contact_phone, client_contact_name',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (!data) return null;
    const row = data as {
      id: string;
      agency_id: string;
      name: string;
      is_agency_workspace?: boolean;
      credits_unlimited?: boolean;
      client_contact_phone?: string | null;
      client_contact_name?: string | null;
    };
    const phone = (row.client_contact_phone ?? '').trim();
    return {
      tenantId: row.id,
      workspaceName: row.name,
      isAgencyWorkspace: Boolean(row.is_agency_workspace),
      creditsUnlimited: Boolean(row.credits_unlimited),
      agencyId: row.agency_id,
      clientPhone: phone.length > 0 ? phone : null,
      clientName: typeof row.client_contact_name === 'string' && row.client_contact_name.trim() ? row.client_contact_name.trim() : null,
    };
  }

  private async loadAgencyContext(agencyId: string): Promise<AgencyContext> {
    const { data } = await this.supabase
      .from('agencies')
      .select(
        'id, name, default_low_credit_warning_enabled, low_credit_warning_thresholds_json, low_credit_warning_message_template, low_credit_warning_send_via_agency_workspace',
      )
      .eq('id', agencyId)
      .maybeSingle();
    const row = (data ?? {}) as {
      id?: string;
      name?: string;
      default_low_credit_warning_enabled?: boolean;
      low_credit_warning_thresholds_json?: unknown;
      low_credit_warning_message_template?: string;
      low_credit_warning_send_via_agency_workspace?: boolean;
    };
    const sanitized = sanitizeThresholdsArray(row.low_credit_warning_thresholds_json);
    return {
      agencyId,
      agencyName: row.name ?? '',
      enabled: Boolean(row.default_low_credit_warning_enabled),
      thresholds: sanitized,
      messageTemplate:
        typeof row.low_credit_warning_message_template === 'string' && row.low_credit_warning_message_template.trim().length > 0
          ? row.low_credit_warning_message_template
          : DEFAULT_LOW_CREDIT_WARNING_MESSAGE_TEMPLATE,
      sendViaAgencyWorkspace:
        row.low_credit_warning_send_via_agency_workspace === undefined
          ? true
          : Boolean(row.low_credit_warning_send_via_agency_workspace),
    };
  }

  private async loadAgencySystemWorkspaceCrm(
    agencyId: string,
  ): Promise<AgencySystemWorkspaceCrm | 'missing_workspace' | 'not_connected'> {
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
    } catch (e) {
      this.logger.warn(`agency workspace token decrypt failed agency=${agencyId} ${e instanceof Error ? e.message : String(e)}`);
      return 'not_connected';
    }
  }

  private async alreadySentForPeriod(
    tenantId: string,
    threshold: number,
    periodEnd: string | null,
  ): Promise<boolean> {
    let q = this.supabase
      .from('workspace_credit_warning_events')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('threshold', threshold)
      .eq('status', 'SENT')
      .limit(1);
    q = periodEnd ? q.eq('billing_period_end', periodEnd) : q.is('billing_period_end', null);
    const { data } = await q.maybeSingle();
    return Boolean(data);
  }

  private async reserveSentEvent(params: {
    agencyId: string;
    tenantId: string;
    threshold: number;
    balanceAtSend: number;
    messagePreview: string;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
  }): Promise<{ eventId: string; alreadyExists: boolean }> {
    const id = randomUUID();
    const { error } = await this.supabase.from('workspace_credit_warning_events').insert({
      id,
      agency_id: params.agencyId,
      tenant_id: params.tenantId,
      threshold: params.threshold,
      balance_at_send: params.balanceAtSend,
      status: 'SENT',
      reason: null,
      message_preview: params.messagePreview,
      billing_period_start: params.billingPeriodStart,
      billing_period_end: params.billingPeriodEnd,
    });
    if (!error) return { eventId: id, alreadyExists: false };
    const code = (error as { code?: string }).code;
    if (code === '23505' || /duplicate key/i.test(error.message ?? '') || /unique/i.test(error.message ?? '')) {
      return { eventId: id, alreadyExists: true };
    }
    this.logger.error(`reserveSentEvent insert failed tenant=${params.tenantId} ${error.message}`);
    throw new Error(error.message);
  }

  private async markEventFailed(eventId: string, reason: string): Promise<void> {
    const trimmed = reason.length > 200 ? reason.slice(0, 200) : reason;
    const { error } = await this.supabase
      .from('workspace_credit_warning_events')
      .update({ status: 'FAILED', reason: trimmed })
      .eq('id', eventId);
    if (error) {
      this.logger.warn(`markEventFailed update failed event=${eventId} ${error.message}`);
    }
  }

  private async recordEvent(params: {
    agencyId: string;
    tenantId: string;
    threshold: number;
    balanceAtSend: number;
    status: 'SKIPPED' | 'FAILED';
    reason: string | null;
    messagePreview: string | null;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
  }): Promise<string | undefined> {
    const id = randomUUID();
    const { error } = await this.supabase.from('workspace_credit_warning_events').insert({
      id,
      agency_id: params.agencyId,
      tenant_id: params.tenantId,
      threshold: params.threshold,
      balance_at_send: params.balanceAtSend,
      status: params.status,
      reason: params.reason,
      message_preview: params.messagePreview,
      billing_period_start: params.billingPeriodStart,
      billing_period_end: params.billingPeriodEnd,
    });
    if (error) {
      this.logger.warn(`recordEvent insert failed tenant=${params.tenantId} ${error.message}`);
      return undefined;
    }
    return id;
  }
}

export const ALLOWED_LOW_CREDIT_WARNING_THRESHOLDS = ALL_LOW_CREDIT_WARNING_THRESHOLDS;
