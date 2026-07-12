import { Injectable } from '@nestjs/common';
import type {
  AccessContext,
  AccessDecision,
  AgencyAccessAction,
  TenantAccessAction,
} from './access-context';

const TENANT_AGENCY_ROLES = {
  read: new Set(['OWNER', 'ADMIN', 'OPERATOR']),
  write: new Set(['OWNER', 'ADMIN']),
  admin: new Set(['OWNER', 'ADMIN']),
} as const;

const TENANT_MEMBER_ROLES = {
  read: new Set(['ADMIN', 'AGENT', 'VIEWER']),
  write: new Set(['ADMIN']),
  admin: new Set(['ADMIN']),
} as const;

@Injectable()
export class AuthorizationPolicyService {
  decideTenantAccess(
    context: AccessContext,
    tenantId: string,
    tenantAgencyId: string,
    action: TenantAccessAction,
  ): AccessDecision {
    const agencyMembership = context.agencyMemberships.find(
      membership => membership.agencyId === tenantAgencyId,
    );
    if (agencyMembership && TENANT_AGENCY_ROLES[action].has(agencyMembership.role as never)) {
      return { allowed: true, reason: 'agency_privileged' };
    }

    const tenantMembership = context.tenantMemberships.find(
      membership =>
        membership.tenantId === tenantId && membership.agencyId === tenantAgencyId,
    );
    if (tenantMembership && TENANT_MEMBER_ROLES[action].has(tenantMembership.role as never)) {
      return { allowed: true, reason: 'tenant_assigned' };
    }

    if (agencyMembership || tenantMembership) {
      return { allowed: false, reason: 'role_insufficient' };
    }
    return { allowed: false, reason: 'no_matching_membership' };
  }

  decideAgencyAccess(
    context: AccessContext,
    agencyId: string,
    action: AgencyAccessAction,
  ): AccessDecision {
    const membership = context.agencyMemberships.find(item => item.agencyId === agencyId);
    if (!membership) return { allowed: false, reason: 'no_matching_membership' };
    if (action === 'read') return { allowed: true, reason: 'agency_member_read' };
    if (membership.role === 'OWNER' || membership.role === 'ADMIN') {
      return { allowed: true, reason: 'agency_privileged' };
    }
    return { allowed: false, reason: 'role_insufficient' };
  }
}
