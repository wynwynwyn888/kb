// Auth service - handles Supabase Auth integration and user resolution
// Maps Supabase auth user -> profile -> agency/tenant access

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type { SessionUser } from '../../lib/supabase';
import type { AgencyRole, TenantRole } from '../../lib/enums';

/** PostgREST may return embedded FK as object or single-element array */
function tenantEmbedAgencyId(tenants: unknown): string | undefined {
  if (tenants && typeof tenants === 'object' && !Array.isArray(tenants) && 'agency_id' in tenants) {
    const id = (tenants as { agency_id: unknown }).agency_id;
    return typeof id === 'string' ? id : undefined;
  }
  if (Array.isArray(tenants) && tenants[0] && typeof tenants[0] === 'object' && tenants[0] !== null && 'agency_id' in tenants[0]) {
    const id = (tenants[0] as { agency_id: unknown }).agency_id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

@Injectable()
export class AuthService {
  /**
   * Verify a JWT token and return the authenticated user
   */
  async verifyToken(token: string): Promise<SessionUser | null> {
    try {
      const supabase = getSupabaseService();

      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (error || !user) {
        if (process.env['AUTH_DEBUG'] === '1') {
          throw new UnauthorizedException(
            `getUser failed: ${error?.message ?? 'no user'}`,
          );
        }
        return null;
      }

      const profile = await this.getProfile(user.id);

      // Strict mode: set AUTH_REQUIRE_PROFILE=1 to reject sessions without a profiles row.
      if (process.env['AUTH_REQUIRE_PROFILE'] === '1' && !profile) {
        if (process.env['AUTH_DEBUG'] === '1') {
          const sb = getSupabaseService();
          const { error: pe } = await sb
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();
          throw new UnauthorizedException(
            `profile missing: ${pe?.message ?? 'no row'} (${pe?.code ?? 'no code'})`,
          );
        }
        return null;
      }

      const agencyMembership = await this.getAgencyMembership(user.id);
      const tenantMemberships = await this.getTenantMemberships(user.id);

      let agencyRole: AgencyRole | undefined;
      let tenantRole: TenantRole | undefined;
      let agencyId: string | undefined;
      let tenantId: string | undefined;

      if (tenantMemberships.length > 0) {
        const primaryTenant = tenantMemberships[0]!;
        tenantRole = primaryTenant.role;
        tenantId = primaryTenant.tenantId;
        // Do not set `agencyId` from the tenant's owning agency — that is not agency *membership*.
        // Frontend and agency APIs use `agencyId` + `agencyRole` only for `agency_users` access.
      }

      if (agencyMembership) {
        agencyRole = agencyMembership.role;
        agencyId = agencyMembership.agencyId;
      }

      return {
        id: user.id,
        email: user.email || '',
        profile: profile ?? undefined,
        agencyRole,
        tenantRole,
        agencyId,
        tenantId,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      return null;
    }
  }

  /**
   * Get profile by auth user ID
   */
  async getProfile(profileId: string): Promise<{ id: string; fullName?: string; avatarUrl?: string } | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('id', profileId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      fullName: data.full_name || undefined,
      avatarUrl: data.avatar_url || undefined,
    };
  }

  /**
   * Get agency membership for a user
   */
  async getAgencyMembership(profileId: string): Promise<{ agencyId: string; role: AgencyRole } | null> {
    const supabase = getSupabaseService();
    // Deterministic when multiple agency_users rows exist (use oldest membership).
    const { data, error } = await supabase
      .from('agency_users')
      .select('agency_id, role')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      agencyId: data.agency_id,
      role: data.role as AgencyRole,
    };
  }

  /**
   * Get all tenant memberships for a user
   */
  async getTenantMemberships(profileId: string): Promise<Array<{ tenantId: string; agencyId: string; role: TenantRole }>> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_users')
      .select('tenant_id, role, tenants!inner(agency_id)')
      .eq('profile_id', profileId);

    if (error || !data) {
      return [];
    }

    const out: Array<{ tenantId: string; agencyId: string; role: TenantRole }> = [];
    for (const d of data) {
      const agencyId = tenantEmbedAgencyId(d.tenants);
      if (!agencyId) {
        continue;
      }
      out.push({
        tenantId: d.tenant_id,
        agencyId,
        role: d.role as TenantRole,
      });
    }
    return out;
  }

  /**
   * Check if user has access to a specific tenant
   */
  async hasTenantAccess(profileId: string, tenantId: string): Promise<boolean> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_users')
      .select('id')
      .eq('profile_id', profileId)
      .eq('tenant_id', tenantId)
      .single();

    return !error && !!data;
  }

  /**
   * Check if user has access to a specific agency
   */
  async hasAgencyAccess(profileId: string, agencyId: string): Promise<boolean> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('agency_users')
      .select('id')
      .eq('profile_id', profileId)
      .eq('agency_id', agencyId)
      .single();

    return !error && !!data;
  }

  /**
   * Check if user is agency admin or higher
   */
  async isAgencyAdmin(profileId: string, agencyId: string): Promise<boolean> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('agency_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('agency_id', agencyId)
      .single();

    if (error || !data) {
      return false;
    }

    return ['OWNER', 'ADMIN'].includes(data.role);
  }

  /**
   * Check if user is tenant admin or higher
   */
  async isTenantAdmin(profileId: string, tenantId: string): Promise<boolean> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return false;
    }

    return ['ADMIN'].includes(data.role);
  }
}
