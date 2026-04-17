// Tenants service - handles tenant operations with multi-tenant isolation

import { Injectable, NotFoundException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type { TenantRole } from '../../lib/enums';

export interface TenantSummary {
  id: string;
  agencyId: string;
  name: string;
  ghlLocationId: string;
  status: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantDetail extends TenantSummary {
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
      ghlLocationId: t.ghl_location_id,
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

    // Get active prompt config
    const { data: prompt } = await supabase
      .from('tenant_prompt_configs')
      .select('id, name, temperature, model_override, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    // Get quota wallet
    const { data: wallet } = await supabase
      .from('quota_wallets')
      .select('total_quota, used_quota, period_start, period_end')
      .eq('tenant_id', tenantId)
      .single();

    return {
      id: tenant.id,
      agencyId: tenant.agency_id,
      name: tenant.name,
      ghlLocationId: tenant.ghl_location_id,
      status: tenant.status,
      settings: tenant.settings,
      createdAt: new Date(tenant.created_at),
      updatedAt: new Date(tenant.updated_at),
      promptConfig: prompt ? {
        id: prompt.id,
        name: prompt.name,
        temperature: prompt.temperature,
        modelOverride: prompt.model_override || undefined,
        isActive: prompt.is_active,
      } : null,
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
          ghlLocationId: tenant.ghl_location_id,
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
}