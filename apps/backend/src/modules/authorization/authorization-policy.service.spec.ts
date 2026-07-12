import { agencyRoleCanReadTenant, AuthorizationPolicyService } from './authorization-policy.service';
import type { AccessContext } from './access-context';

const AGENCY = 'agency-1';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const TENANT_C = 'tenant-c';

function context(partial: Omit<AccessContext, 'profileId' | 'membershipStatus'>): AccessContext {
  return { profileId: 'profile-1', membershipStatus: 'complete', ...partial };
}

describe('AuthorizationPolicyService single-agency contract', () => {
  const policy = new AuthorizationPolicyService();

  it.each(['OWNER', 'ADMIN', 'OPERATOR'] as const)(
    'allows agency %s to read every tenant in its agency',
    role => {
      const ctx = context({ agencyMemberships: [{ agencyId: AGENCY, role }], tenantMemberships: [] });
      for (const tenantId of [TENANT_A, TENANT_B, TENANT_C]) {
        expect(policy.decideTenantAccess(ctx, tenantId, AGENCY, 'read')).toEqual({
          allowed: true,
          reason: 'agency_privileged',
        });
      }
    },
  );

  it('denies agency MEMBER without an explicit tenant assignment', () => {
    const ctx = context({
      agencyMemberships: [{ agencyId: AGENCY, role: 'MEMBER' }],
      tenantMemberships: [],
    });
    expect(policy.decideTenantAccess(ctx, TENANT_A, AGENCY, 'read')).toEqual({
      allowed: false,
      reason: 'role_insufficient',
    });
  });

  it.each(['ADMIN', 'AGENT', 'VIEWER'] as const)(
    'allows assigned tenant %s to read only assigned tenants',
    role => {
      const ctx = context({
        agencyMemberships: [],
        tenantMemberships: [{ tenantId: TENANT_A, agencyId: AGENCY, role }],
      });
      expect(policy.decideTenantAccess(ctx, TENANT_A, AGENCY, 'read').allowed).toBe(true);
      expect(policy.decideTenantAccess(ctx, TENANT_B, AGENCY, 'read').allowed).toBe(false);
    },
  );

  it('uses complete multi-tenant membership rather than a primary tenant shortcut', () => {
    const ctx = context({
      agencyMemberships: [],
      tenantMemberships: [
        { tenantId: TENANT_A, agencyId: AGENCY, role: 'AGENT' },
        { tenantId: TENANT_B, agencyId: AGENCY, role: 'VIEWER' },
      ],
    });
    expect(policy.decideTenantAccess(ctx, TENANT_A, AGENCY, 'read').allowed).toBe(true);
    expect(policy.decideTenantAccess(ctx, TENANT_B, AGENCY, 'read').allowed).toBe(true);
    expect(policy.decideTenantAccess(ctx, TENANT_C, AGENCY, 'read').allowed).toBe(false);
  });

  it('rejects a membership whose agency does not match the tenant parent', () => {
    const ctx = context({
      agencyMemberships: [],
      tenantMemberships: [{ tenantId: TENANT_A, agencyId: 'wrong-agency', role: 'ADMIN' }],
    });
    expect(policy.decideTenantAccess(ctx, TENANT_A, AGENCY, 'read').allowed).toBe(false);
  });

  it('separates read, write, and administration roles', () => {
    const viewer = context({
      agencyMemberships: [],
      tenantMemberships: [{ tenantId: TENANT_A, agencyId: AGENCY, role: 'VIEWER' }],
    });
    const agent = context({
      agencyMemberships: [],
      tenantMemberships: [{ tenantId: TENANT_A, agencyId: AGENCY, role: 'AGENT' }],
    });
    expect(policy.decideTenantAccess(viewer, TENANT_A, AGENCY, 'read').allowed).toBe(true);
    expect(policy.decideTenantAccess(viewer, TENANT_A, AGENCY, 'write').allowed).toBe(false);
    expect(policy.decideTenantAccess(agent, TENANT_A, AGENCY, 'write').allowed).toBe(false);
    expect(policy.decideTenantAccess(agent, TENANT_A, AGENCY, 'admin').allowed).toBe(false);
  });

  it('does not turn operational roles into generic workspace writers', () => {
    const operator = context({
      agencyMemberships: [{ agencyId: AGENCY, role: 'OPERATOR' }],
      tenantMemberships: [],
    });
    expect(policy.decideTenantAccess(operator, TENANT_A, AGENCY, 'read').allowed).toBe(true);
    expect(policy.decideTenantAccess(operator, TENANT_A, AGENCY, 'write').allowed).toBe(false);
  });

  it('denies revoked, unrelated, and empty contexts', () => {
    const revoked = context({ agencyMemberships: [], tenantMemberships: [] });
    expect(policy.decideTenantAccess(revoked, TENANT_A, AGENCY, 'read')).toEqual({
      allowed: false,
      reason: 'no_matching_membership',
    });
  });

  it.each(['partial', 'failed'] as const)('refuses to authorize an explicitly %s context', membershipStatus => {
    const incomplete: AccessContext = {
      profileId: 'profile-1',
      membershipStatus,
      agencyMemberships: [{ agencyId: AGENCY, role: 'OWNER' }],
      tenantMemberships: [],
    };
    expect(policy.decideTenantAccess(incomplete, TENANT_A, AGENCY, 'read')).toEqual({
      allowed: false,
      reason: 'context_incomplete',
    });
  });

  it('allows agency reads to members but restricts agency administration', () => {
    const member = context({
      agencyMemberships: [{ agencyId: AGENCY, role: 'MEMBER' }],
      tenantMemberships: [],
    });
    expect(policy.decideAgencyAccess(member, AGENCY, 'read').allowed).toBe(true);
    expect(policy.decideAgencyAccess(member, AGENCY, 'admin').allowed).toBe(false);
  });
});

describe('agencyRoleCanReadTenant', () => {
  it.each(['OWNER', 'ADMIN', 'OPERATOR'])('allows %s', role => {
    expect(agencyRoleCanReadTenant(role)).toBe(true);
  });

  it.each(['MEMBER', undefined, null, '', 'owner'])('denies %s', role => {
    expect(agencyRoleCanReadTenant(role)).toBe(false);
  });
});
