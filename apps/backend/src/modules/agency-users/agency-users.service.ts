// Agency Users service — membership CRUD for `agency_users` (Supabase)

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getSupabaseService } from '../../lib/supabase';
import type { AgencyRole } from '../../lib/enums';
import { AuthService } from '../auth/auth.service';

const ROLES: readonly AgencyRole[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER'];

export interface AgencyMemberRow {
  id: string;
  agencyId: string;
  profileId: string;
  role: AgencyRole;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AgencyUsersService {
  constructor(private readonly auth: AuthService) {}

  /**
   * List members of an agency. Caller must already be a member of that agency.
   */
  async listMembers(agencyId: string, actorProfileId: string): Promise<AgencyMemberRow[]> {
    const supabase = getSupabaseService();
    const member = await this.getMembership(actorProfileId, agencyId);
    if (!member) {
      throw new NotFoundException('Agency not found');
    }

    const { data, error } = await supabase
      .from('agency_users')
      .select(
        `
        id,
        agency_id,
        profile_id,
        role,
        created_at,
        updated_at,
        profiles (email, full_name)
      `,
      )
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException(`Failed to list members: ${error.message}`);
    }

    return (data ?? []).map(row => {
      const prof = row.profiles as { email?: string; full_name?: string } | null;
      return {
        id: row.id as string,
        agencyId: row.agency_id as string,
        profileId: row.profile_id as string,
        role: row.role as AgencyRole,
        email: prof?.email ?? null,
        fullName: prof?.full_name ?? null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      };
    });
  }

  /**
   * Resolve a single profile id from email (case-insensitive). Fails if not found or ambiguous.
   */
  async resolveProfileIdByEmail(email: string): Promise<string> {
    const supabase = getSupabaseService();
    const e = email.trim();
    if (!e) {
      throw new BadRequestException('email is required');
    }
    const { data, error } = await supabase.from('profiles').select('id').ilike('email', e);
    if (error) {
      throw new BadRequestException(`Could not look up email: ${error.message}`);
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      throw new BadRequestException(
        'No user found with that email. They must sign up first, then you can add them to the team.',
      );
    }
    if (rows.length > 1) {
      throw new BadRequestException('Multiple profiles match that email. Use Advanced → profile id.');
    }
    return (rows[0] as { id: string }).id;
  }

  /**
   * Add a profile to an agency. Caller must be OWNER or ADMIN; only OWNER may assign OWNER.
   */
  async addMember(
    actorProfileId: string,
    dto: { agencyId: string; profileId: string; role: AgencyRole },
  ): Promise<AgencyMemberRow> {
    const supabase = getSupabaseService();
    const { agencyId, profileId, role } = dto;

    const canManage = await this.auth.isAgencyAdmin(actorProfileId, agencyId);
    if (!canManage) {
      throw new ForbiddenException('Insufficient permissions to add members');
    }

    const actorRole = await this.getRole(actorProfileId, agencyId);
    if (role === 'OWNER' && actorRole !== 'OWNER') {
      throw new ForbiddenException('Only an agency OWNER can assign the OWNER role');
    }

    const { data: profileRow, error: pe } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', profileId)
      .maybeSingle();
    if (pe || !profileRow) {
      throw new BadRequestException('Profile not found');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('agency_users')
      .insert({
        id,
        agency_id: agencyId,
        profile_id: profileId,
        role,
        created_at: now,
        updated_at: now,
      })
      .select(
        `
        id,
        agency_id,
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
        throw new ConflictException('User is already a member of this agency');
      }
      throw new BadRequestException(`Failed to add member: ${error.message}`);
    }

    return this.mapRow(data);
  }

  /**
   * Update role for a membership row. Caller must be OWNER or ADMIN; only OWNER may set OWNER.
   */
  async updateRole(
    membershipId: string,
    newRole: AgencyRole,
    actorProfileId: string,
  ): Promise<AgencyMemberRow> {
    const supabase = getSupabaseService();

    const { data: row, error: fe } = await supabase
      .from('agency_users')
      .select('id, agency_id, profile_id, role')
      .eq('id', membershipId)
      .single();

    if (fe || !row) {
      throw new NotFoundException('Membership not found');
    }

    const agencyId = row.agency_id as string;
    const oldRole = row.role as AgencyRole;

    const canManage = await this.auth.isAgencyAdmin(actorProfileId, agencyId);
    if (!canManage) {
      throw new ForbiddenException('Insufficient permissions to change roles');
    }

    const actorRole = await this.getRole(actorProfileId, agencyId);
    if (newRole === 'OWNER' && actorRole !== 'OWNER') {
      throw new ForbiddenException('Only an agency OWNER can assign the OWNER role');
    }

    if (oldRole === 'OWNER' && newRole !== 'OWNER') {
      const others = await this.countOwnersExcept(agencyId, membershipId);
      if (others < 1) {
        throw new BadRequestException('Cannot demote the only OWNER for this agency');
      }
    }

    const { data: updated, error: ue } = await supabase
      .from('agency_users')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', membershipId)
      .select(
        `
        id,
        agency_id,
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
   * Remove a membership. Caller must be OWNER or ADMIN. Cannot remove the sole OWNER.
   */
  async removeMember(membershipId: string, actorProfileId: string): Promise<void> {
    const supabase = getSupabaseService();

    const { data: row, error: fe } = await supabase
      .from('agency_users')
      .select('id, agency_id, role')
      .eq('id', membershipId)
      .single();

    if (fe || !row) {
      throw new NotFoundException('Membership not found');
    }

    const agencyId = row.agency_id as string;
    const role = row.role as AgencyRole;

    const canManage = await this.auth.isAgencyAdmin(actorProfileId, agencyId);
    if (!canManage) {
      throw new ForbiddenException('Insufficient permissions to remove members');
    }

    if (role === 'OWNER') {
      const others = await this.countOwnersExcept(agencyId, membershipId);
      if (others < 1) {
        throw new BadRequestException('Cannot remove the only OWNER for this agency');
      }
    }

    const { error: de } = await supabase.from('agency_users').delete().eq('id', membershipId);
    if (de) {
      throw new BadRequestException(`Failed to remove member: ${de.message}`);
    }
  }

  private async getMembership(
    profileId: string,
    agencyId: string,
  ): Promise<{ role: AgencyRole } | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('agency_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('agency_id', agencyId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }
    return { role: data.role as AgencyRole };
  }

  private async getRole(
    profileId: string,
    agencyId: string,
  ): Promise<AgencyRole | null> {
    const m = await this.getMembership(profileId, agencyId);
    return m?.role ?? null;
  }

  private async countOwnersExcept(agencyId: string, excludeMembershipId: string): Promise<number> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('agency_users')
      .select('id')
      .eq('agency_id', agencyId)
      .eq('role', 'OWNER')
      .neq('id', excludeMembershipId);

    if (error) {
      return 0;
    }
    return (data ?? []).length;
  }

  private mapRow(data: Record<string, unknown>): AgencyMemberRow {
    const prof = data['profiles'] as { email?: string; full_name?: string } | null;
    return {
      id: data['id'] as string,
      agencyId: data['agency_id'] as string,
      profileId: data['profile_id'] as string,
      role: data['role'] as AgencyRole,
      email: prof?.email ?? null,
      fullName: prof?.full_name ?? null,
      createdAt: data['created_at'] as string,
      updatedAt: data['updated_at'] as string,
    };
  }

  static assertValidRole(role: string): asserts role is AgencyRole {
    if (!ROLES.includes(role as AgencyRole)) {
      throw new BadRequestException(
        `role must be one of: ${ROLES.join(', ')}`,
      );
    }
  }
}
