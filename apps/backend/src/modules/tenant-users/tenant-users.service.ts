// Tenant Users service — membership CRUD for `tenant_users` (Supabase)

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getSupabaseService } from '../../lib/supabase';
import type { TenantRole } from '../../lib/enums';
import { AuthService } from '../auth/auth.service';

const ROLES: readonly TenantRole[] = ['ADMIN', 'AGENT', 'VIEWER'];

export interface TenantMemberRow {
  id: string;
  tenantId: string;
  profileId: string;
  role: TenantRole;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TenantUsersService {
  constructor(private readonly auth: AuthService) {}

  /**
   * List members of a tenant. Caller must be a member of that tenant or agency staff for its agency.
   */
  async listMembers(tenantId: string, actorProfileId: string): Promise<TenantMemberRow[]> {
    const supabase = getSupabaseService();
    const member = await this.getMembership(actorProfileId, tenantId);
    if (!member) {
      const agencyOk = await this.isAgencyStaffForTenant(actorProfileId, tenantId);
      if (!agencyOk) {
        throw new NotFoundException('Tenant not found');
      }
    }

    const { data, error } = await supabase
      .from('tenant_users')
      .select(
        `
        id,
        tenant_id,
        profile_id,
        role,
        created_at,
        updated_at,
        profiles (email, full_name)
      `,
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException(`Failed to list members: ${error.message}`);
    }

    return (data ?? []).map(row => {
      const prof = row.profiles as { email?: string; full_name?: string } | null;
      return {
        id: row.id as string,
        tenantId: row.tenant_id as string,
        profileId: row.profile_id as string,
        role: row.role as TenantRole,
        email: prof?.email ?? null,
        fullName: prof?.full_name ?? null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      };
    });
  }

  /**
   * Add a profile to a tenant. Caller must be tenant ADMIN (`AuthService.isTenantAdmin`).
   * Only an existing ADMIN may assign the ADMIN role.
   */
  async addMember(
    actorProfileId: string,
    dto: { tenantId: string; profileId: string; role: TenantRole },
  ): Promise<TenantMemberRow> {
    const supabase = getSupabaseService();
    const { tenantId, profileId, role } = dto;

    const canManage = await this.auth.isTenantAdmin(actorProfileId, tenantId);
    if (!canManage) {
      throw new ForbiddenException('Insufficient permissions to add members');
    }

    const actorRole = await this.getRole(actorProfileId, tenantId);
    if (role === 'ADMIN' && actorRole !== 'ADMIN') {
      throw new ForbiddenException('Only a tenant ADMIN can assign the ADMIN role');
    }

    const { data: profileRow, error: pe } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', profileId)
      .maybeSingle();
    if (pe || !profileRow) {
      throw new BadRequestException('Profile not found');
    }
    if (await this.isAgencyStaffForTenant(profileId, tenantId)) {
      throw new BadRequestException('Agency accounts already have workspace access and cannot be added as customer members');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('tenant_users')
      .insert({
        id,
        tenant_id: tenantId,
        profile_id: profileId,
        role,
        created_at: now,
        updated_at: now,
      })
      .select(
        `
        id,
        tenant_id,
        profile_id,
        role,
        created_at,
        updated_at,
        profiles (email, full_name)
      `,
      )
      .single();

    if (error) {
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        throw new ConflictException('User is already a member of this tenant');
      }
      throw new BadRequestException(`Failed to add member: ${error.message}`);
    }

    return this.mapRow(data);
  }

  /**
   * Update role for a membership row. Tenant ADMIN or agency staff for the workspace agency.
   * Cannot demote the only ADMIN.
   */
  async updateRole(
    membershipId: string,
    newRole: TenantRole,
    actorProfileId: string,
  ): Promise<TenantMemberRow> {
    const supabase = getSupabaseService();

    const { data: row, error: fe } = await supabase
      .from('tenant_users')
      .select('id, tenant_id, profile_id, role')
      .eq('id', membershipId)
      .single();

    if (fe || !row) {
      throw new NotFoundException('Membership not found');
    }

    const tenantId = row.tenant_id as string;
    const oldRole = row.role as TenantRole;

    const canTenantAdmin = await this.auth.isTenantAdmin(actorProfileId, tenantId);
    const canAgency = await this.isAgencyStaffForTenant(actorProfileId, tenantId);
    if (!canTenantAdmin && !canAgency) {
      throw new ForbiddenException('Insufficient permissions to change roles');
    }

    if (newRole === 'ADMIN' && !canAgency) {
      const actorRole = await this.getRole(actorProfileId, tenantId);
      if (actorRole !== 'ADMIN') {
        throw new ForbiddenException('Only a tenant ADMIN can assign the ADMIN role');
      }
    }

    if (oldRole === 'ADMIN' && newRole !== 'ADMIN') {
      const others = await this.countAdminsExcept(tenantId, membershipId);
      if (others < 1) {
        throw new BadRequestException('Cannot demote the only ADMIN for this tenant');
      }
    }

    const { data: updated, error: ue } = await supabase
      .from('tenant_users')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', membershipId)
      .select(
        `
        id,
        tenant_id,
        profile_id,
        role,
        created_at,
        updated_at,
        profiles (email, full_name)
      `,
      )
      .single();

    if (ue || !updated) {
      throw new BadRequestException(
        `Failed to update role: ${ue?.message ?? 'unknown error'}`,
      );
    }

    return this.mapRow(updated);
  }

  /**
   * Remove a membership. Caller must be tenant ADMIN. Cannot remove the sole ADMIN.
   */
  async removeMember(membershipId: string, actorProfileId: string): Promise<void> {
    const supabase = getSupabaseService();

    const { data: row, error: fe } = await supabase
      .from('tenant_users')
      .select('id, tenant_id, role')
      .eq('id', membershipId)
      .single();

    if (fe || !row) {
      throw new NotFoundException('Membership not found');
    }

    const tenantId = row.tenant_id as string;
    const role = row.role as TenantRole;

    const canTenantAdmin = await this.auth.isTenantAdmin(actorProfileId, tenantId);
    const canAgency = await this.isAgencyStaffForTenant(actorProfileId, tenantId);
    if (!canTenantAdmin && !canAgency) {
      throw new ForbiddenException('Insufficient permissions to remove members');
    }

    if (role === 'ADMIN') {
      const others = await this.countAdminsExcept(tenantId, membershipId);
      if (others < 1) {
        throw new BadRequestException('Cannot remove the only ADMIN for this tenant');
      }
    }

    const { error: de } = await supabase.from('tenant_users').delete().eq('id', membershipId);
    if (de) {
      throw new BadRequestException(`Failed to remove member: ${de.message}`);
    }
  }

  private async isAgencyStaffForTenant(actorProfileId: string, tenantId: string): Promise<boolean> {
    const supabase = getSupabaseService();
    const { data: t } = await supabase.from('tenants').select('agency_id').eq('id', tenantId).maybeSingle();
    if (!t?.agency_id) {
      return false;
    }
    return this.auth.hasAgencyAccess(actorProfileId, t.agency_id as string);
  }

  private async getMembership(
    profileId: string,
    tenantId: string,
  ): Promise<{ role: TenantRole } | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }
    return { role: data.role as TenantRole };
  }

  private async getRole(profileId: string, tenantId: string): Promise<TenantRole | null> {
    const m = await this.getMembership(profileId, tenantId);
    return m?.role ?? null;
  }

  private async countAdminsExcept(tenantId: string, excludeMembershipId: string): Promise<number> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('tenant_users')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('role', 'ADMIN')
      .neq('id', excludeMembershipId);

    if (error) {
      return 0;
    }
    return (data ?? []).length;
  }

  private mapRow(data: Record<string, unknown>): TenantMemberRow {
    const prof = data['profiles'] as { email?: string; full_name?: string } | null;
    return {
      id: data['id'] as string,
      tenantId: data['tenant_id'] as string,
      profileId: data['profile_id'] as string,
      role: data['role'] as TenantRole,
      email: prof?.email ?? null,
      fullName: prof?.full_name ?? null,
      createdAt: data['created_at'] as string,
      updatedAt: data['updated_at'] as string,
    };
  }

  static assertValidRole(role: string): asserts role is TenantRole {
    if (!ROLES.includes(role as TenantRole)) {
      throw new BadRequestException(
        `role must be one of: ${ROLES.join(', ')}`,
      );
    }
  }
}
