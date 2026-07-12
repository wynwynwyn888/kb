/**
 * Read-only staging evaluator for legacy-vs-contract tenant read access.
 * Outputs aggregate role/reason counts only; never prints IDs or customer data.
 */
import { getSupabaseService } from '../lib/supabase';
import type { AgencyRole, TenantRole } from '../lib/enums';
import type { AccessContext } from '../modules/authorization/access-context';
import {
  agencyRoleCanReadTenant,
  AuthorizationPolicyService,
} from '../modules/authorization/authorization-policy.service';

const STAGING_REF = 'tuxbrerxmhnotcfrmzct';

function assertStaging(): void {
  const url = String(process.env['SUPABASE_URL'] ?? '');
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Invalid or absent URLs are rejected below.
  }
  if (process.env['NODE_ENV'] === 'production' || hostname !== `${STAGING_REF}.supabase.co`) {
    throw new Error('Refusing authorization-shadow evaluation outside the designated staging Supabase project');
  }
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

async function main(): Promise<void> {
  assertStaging();
  const supabase = getSupabaseService();
  const [tenantsResult, agencyUsersResult, tenantUsersResult] = await Promise.all([
    supabase.from('tenants').select('id, agency_id'),
    supabase.from('agency_users').select('profile_id, agency_id, role'),
    supabase.from('tenant_users').select('profile_id, tenant_id, role, tenants!inner(agency_id)'),
  ]);
  for (const result of [tenantsResult, agencyUsersResult, tenantUsersResult]) {
    if (result.error) throw new Error(`Staging membership query failed: ${result.error.code ?? 'unknown'}`);
  }

  const tenants = (tenantsResult.data ?? []).map(row => ({
    tenantId: String(row.id), agencyId: String(row.agency_id),
  }));
  const agencyRows = (agencyUsersResult.data ?? []).map(row => ({
    profileId: String(row.profile_id), agencyId: String(row.agency_id), role: row.role as AgencyRole,
  }));
  const tenantRows = (tenantUsersResult.data ?? []).flatMap(row => {
    const embedded = row.tenants as unknown;
    const agencyId = Array.isArray(embedded)
      ? (embedded[0] as { agency_id?: unknown } | undefined)?.agency_id
      : (embedded as { agency_id?: unknown } | null)?.agency_id;
    if (typeof agencyId !== 'string') return [];
    return [{
      profileId: String(row.profile_id), tenantId: String(row.tenant_id),
      agencyId, role: row.role as TenantRole,
    }];
  });
  const profileIds = new Set([...agencyRows.map(row => row.profileId), ...tenantRows.map(row => row.profileId)]);
  const policy = new AuthorizationPolicyService();
  const aggregates = {
    profiles: profileIds.size,
    tenants: tenants.length,
    evaluatedPairs: 0,
    match: 0,
    disagreement: 0,
    byLegacyShadow: {} as Record<string, number>,
    byShadowReason: {} as Record<string, number>,
    disagreementsByAgencyRole: {} as Record<string, number>,
  };

  for (const profileId of profileIds) {
    const agencyMemberships = agencyRows
      .filter(row => row.profileId === profileId)
      .map(({ agencyId, role }) => ({ agencyId, role }));
    const tenantMemberships = tenantRows
      .filter(row => row.profileId === profileId)
      .map(({ tenantId, agencyId, role }) => ({ tenantId, agencyId, role }));
    const context: AccessContext = {
      profileId, membershipStatus: 'complete', agencyMemberships, tenantMemberships,
    };
    for (const tenant of tenants) {
      const legacyAllowed = tenantMemberships.some(row => row.tenantId === tenant.tenantId)
        || agencyMemberships.some(
          row => row.agencyId === tenant.agencyId && agencyRoleCanReadTenant(row.role),
        );
      const shadow = policy.decideTenantAccess(context, tenant.tenantId, tenant.agencyId, 'read');
      aggregates.evaluatedPairs += 1;
      increment(aggregates.byLegacyShadow, `legacy_${legacyAllowed}_shadow_${shadow.allowed}`);
      increment(aggregates.byShadowReason, shadow.reason);
      if (legacyAllowed === shadow.allowed) {
        aggregates.match += 1;
      } else {
        aggregates.disagreement += 1;
        const agencyRole = agencyMemberships.find(row => row.agencyId === tenant.agencyId)?.role ?? 'NONE';
        increment(aggregates.disagreementsByAgencyRole, agencyRole);
      }
    }
  }
  console.log(JSON.stringify({ stagingOnly: true, contentFree: true, ...aggregates }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Authorization-shadow staging evaluation failed');
  process.exitCode = 1;
});
