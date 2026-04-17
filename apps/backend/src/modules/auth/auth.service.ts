// Auth service - handles Supabase Auth integration and user resolution
// Maps Supabase auth user -> profile -> agency/tenant access

import { Injectable } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type { SessionUser } from '../../lib/supabase';
import type { AgencyRole, TenantRole } from '@prisma/client';

@Injectable()
export class AuthService {
  /**
   * Verify a JWT token and return the authenticated user
   */
  async verifyToken(token: string): Promise<SessionUser | null> {
    try {
      const supabase = getSupabaseService();

      // Verify the JWT using Supabase service
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (error || !user) {
        return null;
      }

      // Get user profile
      const profile = await this.getProfile(user.id);
      if (!profile) {
        return null;
      }

      // Get agency and tenant memberships
      const agencyMembership = await this.getAgencyMembership(user.id);
      const tenantMemberships = await this.getTenantMemberships(user.id);

      // Determine access level - prefer tenant access if present
      let agencyRole: AgencyRole | undefined;
      let tenantRole: TenantRole | undefined;
      let agencyId: string | undefined;
      let tenantId: string | undefined;

      if (tenantMemberships.length > 0) {
        // User has tenant access - use highest tenant role
        const primaryTenant = tenantMemberships[0];
        tenantRole = primaryTenant.role;
        tenantId = primaryTenant.tenantId;
        agencyId = primaryTenant.agencyId;
      }

      if (agencyMembership) {
        agencyRole = agencyMembership.role;
        agencyId = agencyMembership.agencyId;
      }

      return {
        id: user.id,
        email: user.email || '',
        profile,
        agencyRole,
        tenantRole,
        agencyId,
        tenantId,
      };
    } catch {
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
      .single();

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
    const { data, error } = await supabase
      .from('agency_users')
      .select('agency_id, role')
      .eq('profile_id', profileId)
      .single();

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

    return data.map(d => ({
      tenantId: d.tenant_id,
      agencyId: (d.tenants as unknown as { agency_id: string }).agency_id,
      role: d.role as TenantRole,
    }));
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