// Tenants service - handles tenant operations with multi-tenant isolation

import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type { TenantRole } from '../../lib/enums';
import { resolveBotMode, type BotOperatingMode, isBotModeString } from '../../lib/bot-mode';
import { BotProfilesService } from '../prompts/bot-profiles.service';

/** When the DB enforces NOT NULL on `ghl_location_id`, store a sentinel until a real GHL id is set in Integrations. */
const PENDING_GHL_PREFIX = 'pending:';

function toPublicGhlLocationId(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  if (stored.startsWith(PENDING_GHL_PREFIX)) return null;
  return stored;
}

export interface TenantClientProfile {
  clientContactName: string | null;
  clientContactPhone: string | null;
  clientContactEmail: string | null;
}

export interface TenantSummary {
  id: string;
  agencyId: string;
  name: string;
  ghlLocationId: string | null;
  status: string;
  settings: Record<string, unknown>;
  isAgencyWorkspace: boolean;
  creditsUnlimited: boolean;
  clientContactName: string | null;
  clientContactPhone: string | null;
  clientContactEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const PHONE_TRIM_RE = /[\s()\-]+/g;
function lightlyNormalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Keep + prefix; strip whitespace and common visual separators only.
  const cleaned = trimmed.replace(PHONE_TRIM_RE, '');
  return cleaned.length > 0 ? cleaned : null;
}

function lightlyNormalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const AGENCY_WORKSPACE_NAME_FALLBACK = 'Agency workspace';

export interface TenantDetail extends TenantSummary {
  /** AI reply mode for this workspace; drives `bot_enabled` on write. */
  botMode: BotOperatingMode;
  /** Column mirror; `false` only when mode is `off`. */
  botEnabled: boolean;
  promptConfig?: {
    id: string;
    name: string;
    temperature: number;
    modelOverride?: string;
    isActive: boolean;
  } | null;
  quota?: {
    totalQuota: number;
    usedQuota: number;
    remainingQuota: number;
    periodStart: Date;
    periodEnd: Date;
  } | null;
}

@Injectable()
export class TenantsService {
  constructor(private readonly botProfiles: BotProfilesService) {}

  /**
   * Get all tenants for an agency (agency-level access required)
   */
  async getTenantsByAgency(agencyId: string, profileId: string): Promise<TenantSummary[]> {
    const supabase = getSupabaseService();

    // Verify user is agency member
    const { data: membership, error: membershipError } = await supabase
      .from('agency_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('agency_id', agencyId)
      .single();

    if (membershipError || !membership) {
      return [];
    }

    // Get all tenants for agency
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false });

    if (error) {
      return [];
    }

    return (data || []).map(t => ({
      id: t.id,
      agencyId: t.agency_id,
      name: t.name,
      ghlLocationId: toPublicGhlLocationId(t.ghl_location_id),
      status: t.status,
      settings: t.settings,
      isAgencyWorkspace: Boolean((t as { is_agency_workspace?: boolean }).is_agency_workspace),
      creditsUnlimited: Boolean((t as { credits_unlimited?: boolean }).credits_unlimited),
      clientContactName: (t as { client_contact_name?: string | null }).client_contact_name ?? null,
      clientContactPhone: (t as { client_contact_phone?: string | null }).client_contact_phone ?? null,
      clientContactEmail: (t as { client_contact_email?: string | null }).client_contact_email ?? null,
      createdAt: new Date(t.created_at),
      updatedAt: new Date(t.updated_at),
    }));
  }

  /**
   * Get tenant by ID with access check
   */
  async getTenantById(tenantId: string, profileId: string): Promise<TenantDetail | null> {
    const supabase = getSupabaseService();

    // Get tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      return null;
    }

    // Check if user has access (either as agency member or tenant member)
    const hasAccess = await this.checkTenantAccess(tenantId, profileId);
    if (!hasAccess) {
      return null;
    }

    let promptDetail = await this.botProfiles.getActiveProfileSnapshotForSettings(tenantId);
    if (!promptDetail) {
      const { data: p } = await supabase
        .from('tenant_prompt_configs')
        .select('id, name, temperature, model_override, is_active')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (p) {
        promptDetail = {
          id: p.id as string,
          name: p.name as string,
          temperature: p.temperature as number,
          modelOverride: (p.model_override as string | undefined) || undefined,
          isActive: Boolean(p.is_active),
        };
      }
    }

    // Get quota wallet
    const { data: wallet } = await supabase
      .from('quota_wallets')
      .select('total_quota, used_quota, period_start, period_end')
      .eq('tenant_id', tenantId)
      .single();

    const settingsObj =
      tenant.settings && typeof tenant.settings === 'object' && tenant.settings !== null
        ? (tenant.settings as Record<string, unknown>)
        : {};
    const botEnabled = Boolean((tenant as { bot_enabled?: boolean }).bot_enabled);

    return {
      id: tenant.id,
      agencyId: tenant.agency_id,
      name: tenant.name,
      ghlLocationId: toPublicGhlLocationId(tenant.ghl_location_id),
      status: tenant.status,
      settings: tenant.settings,
      isAgencyWorkspace: Boolean((tenant as { is_agency_workspace?: boolean }).is_agency_workspace),
      creditsUnlimited: Boolean((tenant as { credits_unlimited?: boolean }).credits_unlimited),
      clientContactName: (tenant as { client_contact_name?: string | null }).client_contact_name ?? null,
      clientContactPhone: (tenant as { client_contact_phone?: string | null }).client_contact_phone ?? null,
      clientContactEmail: (tenant as { client_contact_email?: string | null }).client_contact_email ?? null,
      botMode: resolveBotMode(settingsObj, botEnabled),
      botEnabled,
      createdAt: new Date(tenant.created_at),
      updatedAt: new Date(tenant.updated_at),
      promptConfig: promptDetail
        ? {
            id: promptDetail.id,
            name: promptDetail.name,
            temperature: promptDetail.temperature,
            modelOverride: promptDetail.modelOverride,
            isActive: promptDetail.isActive,
          }
        : null,
      quota: wallet ? {
        totalQuota: wallet.total_quota,
        usedQuota: wallet.used_quota,
        remainingQuota: wallet.total_quota - wallet.used_quota,
        periodStart: new Date(wallet.period_start),
        periodEnd: new Date(wallet.period_end),
      } : null,
    };
  }

  /**
   * Get tenants for a user (via tenant_users membership)
   */
  async getTenantsForUser(profileId: string): Promise<TenantSummary[]> {
    const supabase = getSupabaseService();

    const { data, error } = await supabase
      .from('tenant_users')
      .select(`
        role,
        tenants (
          id,
          agency_id,
          name,
          ghl_location_id,
          status,
          settings,
          is_agency_workspace,
          credits_unlimited,
          client_contact_name,
          client_contact_phone,
          client_contact_email,
          created_at,
          updated_at
        )
      `)
      .eq('profile_id', profileId);

    if (error || !data) {
      return [];
    }

    return data
      .filter(d => d.tenants)
      .map(d => {
        const tenant = d.tenants as unknown as {
          id: string;
          agency_id: string;
          name: string;
          ghl_location_id: string;
          status: string;
          settings: Record<string, unknown>;
          is_agency_workspace?: boolean;
          credits_unlimited?: boolean;
          client_contact_name?: string | null;
          client_contact_phone?: string | null;
          client_contact_email?: string | null;
          created_at: string;
          updated_at: string;
        };
        return {
          id: tenant.id,
          agencyId: tenant.agency_id,
          name: tenant.name,
          ghlLocationId: toPublicGhlLocationId(tenant.ghl_location_id),
          status: tenant.status,
          settings: tenant.settings,
          isAgencyWorkspace: Boolean(tenant.is_agency_workspace),
          creditsUnlimited: Boolean(tenant.credits_unlimited),
          clientContactName: tenant.client_contact_name ?? null,
          clientContactPhone: tenant.client_contact_phone ?? null,
          clientContactEmail: tenant.client_contact_email ?? null,
          createdAt: new Date(tenant.created_at),
          updatedAt: new Date(tenant.updated_at),
        };
      });
  }

  /**
   * Check if user has access to a tenant
   */
  async checkTenantAccess(tenantId: string, profileId: string): Promise<boolean> {
    const supabase = getSupabaseService();

    // First check tenant_users
    const { data: tenantMembership } = await supabase
      .from('tenant_users')
      .select('id')
      .eq('profile_id', profileId)
      .eq('tenant_id', tenantId)
      .single();

    if (tenantMembership) {
      return true;
    }

    // Check if user is agency member for tenant's agency
    const { data: tenant } = await supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .single();

    if (!tenant) {
      return false;
    }

    const { data: agencyMembership } = await supabase
      .from('agency_users')
      .select('id')
      .eq('profile_id', profileId)
      .eq('agency_id', tenant.agency_id)
      .single();

    return !!agencyMembership;
  }

  /**
   * Get tenant user role
   */
  async getTenantUserRole(tenantId: string, profileId: string): Promise<TenantRole | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return null;
    }

    return data.role as TenantRole;
  }

  /**
   * Create a client workspace under an agency (agency staff only).
   *
   * Lifecycle inputs (all optional with sensible defaults):
   *  - `annualPlanDurationMonths` — defaults to 12 → wallet `period_end` = now + duration
   *  - `initialCredits` — defaults to agency `defaultSubaccountQuota`, falling back to 36000
   *  - `clientContactName` / `clientContactPhone` / `clientContactEmail` — used by the
   *    automated low-credit warning send path; missing fields don't block create.
   *
   * GHL location id is optional (sentinel until Integrations connect).
   */
  async createTenant(
    agencyId: string,
    profileId: string,
    input: {
      name: string;
      ghlLocationId?: string | null;
      annualPlanDurationMonths?: number;
      initialCredits?: number;
      clientContactName?: string | null;
      clientContactPhone?: string | null;
      clientContactEmail?: string | null;
    },
  ): Promise<TenantSummary> {
    const supabase = getSupabaseService();
    const ok = await this.assertAgencyStaff(agencyId, profileId);
    if (!ok) throw new ForbiddenException('Agency access required');

    const name = input.name?.trim();
    if (!name) throw new BadRequestException('name is required');

    const { data: agency } = await supabase
      .from('agencies')
      .select(
        'default_subaccount_quota, default_allow_temporary_overage, default_overage_limit_credits, default_low_credit_warning_enabled, default_low_credit_warning_level_credits',
      )
      .eq('id', agencyId)
      .single();
    const a = agency as {
      default_subaccount_quota?: number;
      default_allow_temporary_overage?: boolean;
      default_overage_limit_credits?: number;
      default_low_credit_warning_enabled?: boolean;
      default_low_credit_warning_level_credits?: number;
    } | null;
    const agencyDefault = a?.default_subaccount_quota ?? 36_000;
    const requestedCredits = input.initialCredits;
    const initialCredits =
      requestedCredits !== undefined && requestedCredits !== null && Number.isFinite(requestedCredits)
        ? Math.max(0, Math.floor(requestedCredits))
        : agencyDefault;
    const allowNeg = Boolean(a?.default_allow_temporary_overage);
    const negLimit = allowNeg ? Math.max(0, Math.floor(a?.default_overage_limit_credits ?? 0)) : 0;
    const warnOn = Boolean(a?.default_low_credit_warning_enabled);
    const lowTh = warnOn ? Math.max(0, Math.floor(a?.default_low_credit_warning_level_credits ?? 0)) : 0;

    // Annual plan duration: only 1y is required for this pass; allow 1..36 months as a guardrail.
    const requestedMonths = input.annualPlanDurationMonths;
    const annualPlanDurationMonths =
      requestedMonths !== undefined && requestedMonths !== null && Number.isFinite(requestedMonths)
        ? Math.min(36, Math.max(1, Math.floor(requestedMonths)))
        : 12;

    const clientContactName = input.clientContactName?.trim() || null;
    const clientContactPhone = lightlyNormalizePhone(input.clientContactPhone);
    const clientContactEmail = lightlyNormalizeEmail(input.clientContactEmail);

    const id = randomUUID();
    const ghl = input.ghlLocationId?.trim() || `${PENDING_GHL_PREFIX}${id}`;
    const nowIso = new Date().toISOString();

    const { data: row, error } = await supabase
      .from('tenants')
      .insert({
        id,
        agency_id: agencyId,
        name,
        ghl_location_id: ghl,
        status: 'pending',
        settings: {},
        is_agency_workspace: false,
        credits_unlimited: false,
        client_contact_name: clientContactName,
        client_contact_phone: clientContactPhone,
        client_contact_email: clientContactEmail,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('*')
      .single();

    if (error || !row) {
      throw new BadRequestException(error?.message ?? 'Failed to create workspace');
    }

    const now = new Date();
    const periodStart = now;
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + annualPlanDurationMonths);

    const walletNow = new Date().toISOString();
    const { error: walletErr } = await supabase.from('quota_wallets').insert({
      id: randomUUID(),
      tenant_id: id,
      total_quota: initialCredits,
      used_quota: 0,
      allow_negative_credits: allowNeg,
      negative_credit_limit: negLimit,
      low_credit_threshold: lowTh,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      updated_at: walletNow,
    });
    if (walletErr) {
      throw new BadRequestException(walletErr.message ?? 'Failed to create credit wallet for new workspace');
    }

    await supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: profileId,
      tenant_id: id,
      action: 'subaccount.create',
      delta: initialCredits,
      previous_total: 0,
      new_total: initialCredits,
      metadata: {
        name,
        initialCredits,
        annualPlanDurationMonths,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        hasClientPhone: clientContactPhone !== null,
      },
    });

    return {
      id: row.id,
      agencyId: row.agency_id,
      name: row.name,
      ghlLocationId: toPublicGhlLocationId(row.ghl_location_id),
      status: row.status,
      settings: row.settings as Record<string, unknown>,
      isAgencyWorkspace: Boolean((row as { is_agency_workspace?: boolean }).is_agency_workspace),
      creditsUnlimited: Boolean((row as { credits_unlimited?: boolean }).credits_unlimited),
      clientContactName: clientContactName,
      clientContactPhone: clientContactPhone,
      clientContactEmail: clientContactEmail,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /** Same as `ensureAgencySystemWorkspace` but enforces agency staff access first. */
  async ensureAgencySystemWorkspaceForActor(agencyId: string, profileId: string): Promise<TenantSummary> {
    const ok = await this.assertAgencyStaff(agencyId, profileId);
    if (!ok) throw new ForbiddenException('Agency access required');
    return this.ensureAgencySystemWorkspace(agencyId);
  }

  /**
   * Idempotent: return the agency's single internal workspace, creating it on first use.
   *
   * The agency workspace is marked `is_agency_workspace = true` and `credits_unlimited = true`,
   * so it's never billed and never blocked by credit checks. Only one row per agency is allowed
   * (enforced by partial unique index on `tenants(agency_id) WHERE is_agency_workspace`).
   */
  async ensureAgencySystemWorkspace(agencyId: string): Promise<TenantSummary> {
    const supabase = getSupabaseService();

    const { data: existing } = await supabase
      .from('tenants')
      .select('*')
      .eq('agency_id', agencyId)
      .eq('is_agency_workspace', true)
      .maybeSingle();
    if (existing) {
      return this.mapRowToSummary(existing as Record<string, unknown>);
    }

    const { data: agencyRow } = await supabase
      .from('agencies')
      .select('id, name')
      .eq('id', agencyId)
      .maybeSingle();
    const agencyName = (agencyRow as { name?: string } | null)?.name?.trim() ?? '';
    const wsName = agencyName ? `${agencyName} workspace` : AGENCY_WORKSPACE_NAME_FALLBACK;

    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const { data: row, error } = await supabase
      .from('tenants')
      .insert({
        id,
        agency_id: agencyId,
        name: wsName,
        ghl_location_id: `${PENDING_GHL_PREFIX}${id}`,
        status: 'active',
        settings: { agencySystemWorkspace: true },
        bot_enabled: false,
        is_agency_workspace: true,
        credits_unlimited: true,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('*')
      .single();

    if (error || !row) {
      // Race: another caller may have created it concurrently — re-read and return.
      const { data: retry } = await supabase
        .from('tenants')
        .select('*')
        .eq('agency_id', agencyId)
        .eq('is_agency_workspace', true)
        .maybeSingle();
      if (retry) return this.mapRowToSummary(retry as Record<string, unknown>);
      throw new BadRequestException(error?.message ?? 'Failed to create agency workspace');
    }
    return this.mapRowToSummary(row as Record<string, unknown>);
  }

  /**
   * Update editable client profile fields for a workspace (agency staff only).
   * Pass `undefined` to leave a field unchanged; pass `null` or `''` to clear it.
   */
  async updateClientProfile(
    tenantId: string,
    profileId: string,
    input: { clientContactName?: string | null; clientContactPhone?: string | null; clientContactEmail?: string | null },
  ): Promise<TenantSummary> {
    const supabase = getSupabaseService();
    const { data: t } = await supabase.from('tenants').select('agency_id').eq('id', tenantId).maybeSingle();
    if (!t) throw new NotFoundException('Workspace not found');
    const ok = await this.assertAgencyStaff((t as { agency_id: string }).agency_id, profileId);
    if (!ok) throw new ForbiddenException('Agency access required');

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.clientContactName !== undefined) {
      const v = input.clientContactName?.trim();
      patch['client_contact_name'] = v && v.length > 0 ? v : null;
    }
    if (input.clientContactPhone !== undefined) {
      patch['client_contact_phone'] = lightlyNormalizePhone(input.clientContactPhone);
    }
    if (input.clientContactEmail !== undefined) {
      patch['client_contact_email'] = lightlyNormalizeEmail(input.clientContactEmail);
    }
    if (Object.keys(patch).length <= 1) {
      throw new BadRequestException('Provide at least one client profile field to update');
    }
    const { data: row, error } = await supabase
      .from('tenants')
      .update(patch)
      .eq('id', tenantId)
      .select('*')
      .single();
    if (error || !row) {
      throw new BadRequestException(error?.message ?? 'Update failed');
    }
    return this.mapRowToSummary(row as Record<string, unknown>);
  }

  private mapRowToSummary(t: Record<string, unknown>): TenantSummary {
    return {
      id: t['id'] as string,
      agencyId: t['agency_id'] as string,
      name: t['name'] as string,
      ghlLocationId: toPublicGhlLocationId((t['ghl_location_id'] ?? null) as string | null),
      status: (t['status'] as string) ?? 'pending',
      settings: (t['settings'] as Record<string, unknown>) ?? {},
      isAgencyWorkspace: Boolean(t['is_agency_workspace']),
      creditsUnlimited: Boolean(t['credits_unlimited']),
      clientContactName: (t['client_contact_name'] as string | null) ?? null,
      clientContactPhone: (t['client_contact_phone'] as string | null) ?? null,
      clientContactEmail: (t['client_contact_email'] as string | null) ?? null,
      createdAt: new Date(String(t['created_at'])),
      updatedAt: new Date(String(t['updated_at'])),
    };
  }

  /**
   * Partial update: rename (agency staff only) and/or set AI operating mode (anyone with tenant access).
   */
  async updateTenant(
    tenantId: string,
    profileId: string,
    input: { name?: string; botMode?: BotOperatingMode },
  ): Promise<TenantDetail> {
    if (input.name === undefined && input.botMode === undefined) {
      throw new BadRequestException('Provide at least one of: name, botMode');
    }

    const supabase = getSupabaseService();
    const { data: tenant, error: tErr } = await supabase
      .from('tenants')
      .select('agency_id, name, settings, bot_enabled')
      .eq('id', tenantId)
      .single();
    if (tErr || !tenant) throw new NotFoundException('Subaccount not found');

    const hasAccess = await this.checkTenantAccess(tenantId, profileId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }

    if (input.name !== undefined) {
      const canRename = await this.assertAgencyStaff(
        (tenant as { agency_id: string }).agency_id,
        profileId,
      );
      if (!canRename) {
        throw new ForbiddenException('Agency access required to rename a workspace');
      }
    }

    if (input.botMode !== undefined && !isBotModeString(input.botMode)) {
      throw new BadRequestException('botMode must be off, suggestive, or autopilot');
    }

    const n = input.name !== undefined ? input.name.trim() : null;
    if (input.name !== undefined && !n) {
      throw new BadRequestException('name is required when provided');
    }
    const previousName = (tenant as { name?: string }).name ?? '';
    const prevSettings =
      tenant.settings && typeof tenant.settings === 'object' && tenant.settings !== null
        ? { ...(tenant.settings as Record<string, unknown>) }
        : {};
    const nextSettings =
      input.botMode !== undefined ? { ...prevSettings, botMode: input.botMode } : prevSettings;
    const nextBotEnabled = input.botMode !== undefined ? input.botMode !== 'off' : undefined;

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = { updated_at: nowIso };
    if (n != null) updatePayload['name'] = n;
    if (input.botMode !== undefined) {
      updatePayload['settings'] = nextSettings;
      updatePayload['bot_enabled'] = nextBotEnabled;
    }

    const { data: row, error } = await supabase
      .from('tenants')
      .update(updatePayload)
      .eq('id', tenantId)
      .select('*')
      .single();

    if (error || !row) {
      throw new BadRequestException(error?.message ?? 'Update failed');
    }

    const full = await this.getTenantById(tenantId, profileId);
    if (!full) {
      throw new BadRequestException('Failed to load workspace after update');
    }

    if (n != null && n !== previousName) {
      await supabase.from('quota_audit_logs').insert({
        id: randomUUID(),
        agency_id: row.agency_id,
        profile_id: profileId,
        tenant_id: tenantId,
        action: 'subaccount.renamed',
        delta: 0,
        previous_total: null,
        new_total: null,
        metadata: { previousName, newName: n },
      });
    }

    if (input.botMode !== undefined) {
      await supabase.from('quota_audit_logs').insert({
        id: randomUUID(),
        agency_id: row.agency_id,
        profile_id: profileId,
        tenant_id: tenantId,
        action: 'subaccount.bot_mode',
        delta: 0,
        previous_total: null,
        new_total: null,
        metadata: { botMode: input.botMode },
      });
    }

    return full;
  }

  /**
   * Permanently remove a workspace and dependent rows (DB cascades). Agency staff only.
   * The agency system workspace cannot be deleted via this path.
   */
  async deleteTenant(tenantId: string, profileId: string): Promise<void> {
    const supabase = getSupabaseService();
    const { data: row, error: fErr } = await supabase
      .from('tenants')
      .select('id, agency_id, name, is_agency_workspace')
      .eq('id', tenantId)
      .single();
    if (fErr || !row) {
      throw new NotFoundException('Workspace not found');
    }
    if ((row as { is_agency_workspace?: boolean }).is_agency_workspace) {
      throw new ForbiddenException('Agency workspace cannot be deleted');
    }
    const ok = await this.assertAgencyStaff(row.agency_id, profileId);
    if (!ok) {
      throw new ForbiddenException('Agency access required');
    }
    const agencyId = row.agency_id as string;
    const subName = (row as { name?: string }).name ?? '';

    await supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: profileId,
      tenant_id: tenantId,
      action: 'subaccount.deleted',
      delta: 0,
      previous_total: null,
      new_total: null,
      metadata: { name: subName },
    });

    const { error } = await supabase.from('tenants').delete().eq('id', tenantId);
    if (error) {
      throw new BadRequestException(error.message ?? 'Failed to delete subaccount');
    }
  }

  private async assertAgencyStaff(agencyId: string, profileId: string): Promise<boolean> {
    const supabase = getSupabaseService();
    const { data } = await supabase
      .from('agency_users')
      .select('id')
      .eq('agency_id', agencyId)
      .eq('profile_id', profileId)
      .maybeSingle();
    return !!data;
  }
}