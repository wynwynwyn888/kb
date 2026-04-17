// Agencies service - handles agency operations

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { getSupabaseService } from '../../../lib/supabase';
import type { AgencyRole } from '@prisma/client';

export interface AgencyWithRole {
  id: string;
  name: string;
  settings: Record<string, unknown>;
  role: AgencyRole;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AgenciesService {
  /**
   * Get agency by ID with role check
   */
  async getAgencyById(agencyId: string, profileId: string): Promise<AgencyWithRole | null> {
    const supabase = getSupabaseService();

    // Check agency membership
    const membership = await this.getAgencyMembership(profileId, agencyId);
    if (!membership) {
      return null;
    }

    // Get agency
    const { data, error } = await supabase
      .from('agencies')
      .select('*')
      .eq('id', agencyId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      ...data,
      role: membership.role,
    };
  }

  /**
   * Get all agencies for a user (via agency_users join)
   */
  async getAgenciesForUser(profileId: string): Promise<AgencyWithRole[]> {
    const supabase = getSupabaseService();

    const { data, error } = await supabase
      .from('agency_users')
      .select(`
        role,
        agencies (
          id,
          name,
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
      .filter(d => d.agencies)
      .map(d => ({
        id: d.agencies.id,
        name: d.agencies.name,
        settings: d.agencies.settings,
        role: d.role as AgencyRole,
        createdAt: new Date(d.agencies.created_at),
        updatedAt: new Date(d.agencies.updated_at),
      }));
  }

  /**
   * Get agency membership for a user
   */
  async getAgencyMembership(profileId: string, agencyId: string): Promise<{ role: AgencyRole } | null> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase
      .from('agency_users')
      .select('role')
      .eq('profile_id', profileId)
      .eq('agency_id', agencyId)
      .single();

    if (error || !data) {
      return null;
    }

    return { role: data.role as AgencyRole };
  }

  /**
   * Check if user is agency admin or owner
   */
  async isAgencyAdmin(profileId: string, agencyId: string): Promise<boolean> {
    const membership = await this.getAgencyMembership(profileId, agencyId);
    if (!membership) return false;
    return ['OWNER', 'ADMIN'].includes(membership.role);
  }
}