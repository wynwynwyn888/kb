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

export interface TenantSummary {
  id: string;
  agencyId: string;
  name: string;
  ghlLocationId: string | null;
  status: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

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
        const tenant = d.tenants as unknown as { id: string; agency_id: string; name: string; ghl_location_id: string; status: string; settings: Record<string, unknown>; created_at: string; updated_at: string };
        return {
          id: tenant.id,
          agencyId: tenant.agency_id,
          name: tenant.name,
          ghlLocationId: toPublicGhlLocationId(tenant.ghl_location_id),
          status: tenant.status,
          settings: tenant.settings,
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
   * Create a subaccount under an agency (agency staff only). GHL location optional until Integrations.
   */
  async createTenant(
    agencyId: string,
    profileId: string,
    input: { name: string; ghlLocationId?: string | null },
  ): Promise<TenantSummary> {
    const supabase = getSupabaseService();
    const ok = await this.assertAgencyStaff(agencyId, profileId);
    if (!ok) throw new ForbiddenException('Agency access required');

    const name = input.name?.trim();
    if (!name) throw new BadRequestException('name is required');

    const { data: agency } = await supabase
      .from('agencies')
      .select('default_subaccount_quota')
      .eq('id', agencyId)
      .single();
    const defaultQuota = (agency as { default_subaccount_quota?: number } | null)?.default_subaccount_quota ?? 10_000;

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
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('*')
      .single();

    if (error || !row) {
      throw new BadRequestException(error?.message ?? 'Failed to create subaccount');
    }

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    await supabase.from('quota_wallets').insert({
      id: randomUUID(),
      tenant_id: id,
      total_quota: defaultQuota,
      used_quota: 0,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    });

    await supabase.from('quota_audit_logs').insert({
      id: randomUUID(),
      agency_id: agencyId,
      profile_id: profileId,
      tenant_id: id,
      action: 'subaccount.create',
      delta: defaultQuota,
      previous_total: 0,
      new_total: defaultQuota,
      metadata: { name, defaultQuota },
    });

    return {
      id: row.id,
      agencyId: row.agency_id,
      name: row.name,
      ghlLocationId: toPublicGhlLocationId(row.ghl_location_id),
      status: row.status,
      settings: row.settings as Record<string, unknown>,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
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
   * Permanently remove a subaccount and dependent rows (DB cascades). Agency staff only.
   */
  async deleteTenant(tenantId: string, profileId: string): Promise<void> {
    const supabase = getSupabaseService();
    const { data: row, error: fErr } = await supabase
      .from('tenants')
      .select('id, agency_id, name')
      .eq('id', tenantId)
      .single();
    if (fErr || !row) {
      throw new NotFoundException('Subaccount not found');
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