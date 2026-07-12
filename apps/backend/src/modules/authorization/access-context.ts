import type { AgencyRole, TenantRole } from '../../lib/enums';

export interface AgencyAccessMembership {
  agencyId: string;
  role: AgencyRole;
}
export interface TenantAccessMembership {
  tenantId: string;
  agencyId: string;
  role: TenantRole;
}

/**
 * Complete authorization facts for one authenticated profile.
 *
 * This intentionally excludes bearer tokens and customer data. Batch 3's
 * request-scoped database client will receive the token separately so the
 * context remains safe to inspect in a debugger or structured log sanitizer.
 */
export interface AccessContext {
  profileId: string;
  membershipStatus: 'complete' | 'partial' | 'failed';
  agencyMemberships: AgencyAccessMembership[];
  tenantMemberships: TenantAccessMembership[];
}

export type TenantAccessAction = 'read' | 'write' | 'admin';
export type AgencyAccessAction = 'read' | 'admin';

export interface AccessDecision {
  allowed: boolean;
  reason:
    | 'agency_privileged'
    | 'tenant_assigned'
    | 'agency_member_read'
    | 'context_incomplete'
    | 'no_matching_membership'
    | 'role_insufficient';
}
