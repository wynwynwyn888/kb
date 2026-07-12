import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type { AgencyRole, TenantRole } from '../../lib/enums';
import type { AccessContext, TenantAccessAction } from './access-context';
import { AuthorizationPolicyService } from './authorization-policy.service';

export interface TenantShadowObservation {
  profileId: string;
  tenantId: string;
  action: TenantAccessAction;
  legacyAllowed: boolean;
  source: string;
}
function enabled(): boolean {
  return String(process.env['AUTHORIZATION_SHADOW_ENABLED'] ?? '').trim().toLowerCase() === 'true';
}

function logMatches(): boolean {
  return String(process.env['AUTHORIZATION_SHADOW_LOG_MATCHES'] ?? '').trim().toLowerCase() === 'true';
}

function safeId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

@Injectable()
export class AuthorizationShadowService {
  private readonly logger = new Logger(AuthorizationShadowService.name);

  constructor(private readonly policy: AuthorizationPolicyService) {}

  /**
   * Observe only. This method never returns an authorization result and never
   * throws into the legacy request path. The existing decision remains final.
   */
  async observeTenantAccess(observation: TenantShadowObservation): Promise<void> {
    if (!enabled()) return;
    try {
      const loaded = await this.loadContext(observation.profileId, observation.tenantId);
      if (!loaded) {
        this.logger.warn(
          `authorizationShadowUnavailable ${JSON.stringify({
            source: observation.source,
            action: observation.action,
            profileHash: safeId(observation.profileId),
            tenantHash: safeId(observation.tenantId),
            reason: 'tenant_not_found_or_query_failed',
          })}`,
        );
        return;
      }
      const shadow = this.policy.decideTenantAccess(
        loaded.context,
        observation.tenantId,
        loaded.tenantAgencyId,
        observation.action,
      );
      const payload = {
        source: observation.source,
        action: observation.action,
        profileHash: safeId(observation.profileId),
        tenantHash: safeId(observation.tenantId),
        legacyAllowed: observation.legacyAllowed,
        shadowAllowed: shadow.allowed,
        shadowReason: shadow.reason,
      };
      if (shadow.allowed !== observation.legacyAllowed) {
        this.logger.warn(`authorizationShadowDisagreement ${JSON.stringify(payload)}`);
      } else if (logMatches()) {
        this.logger.log(`authorizationShadowMatch ${JSON.stringify(payload)}`);
      }
    } catch (error) {
      this.logger.warn(
        `authorizationShadowError ${JSON.stringify({
          source: observation.source,
          action: observation.action,
          profileHash: safeId(observation.profileId),
          tenantHash: safeId(observation.tenantId),
          errorType: error instanceof Error ? error.name : 'unknown',
        })}`,
      );
    }
  }

  private async loadContext(
    profileId: string,
    tenantId: string,
  ): Promise<{ context: AccessContext; tenantAgencyId: string } | null> {
    const supabase = getSupabaseService();
    const [tenantResult, agencyResult, tenantMembershipResult] = await Promise.all([
      supabase.from('tenants').select('agency_id').eq('id', tenantId).maybeSingle(),
      supabase.from('agency_users').select('agency_id, role').eq('profile_id', profileId),
      supabase
        .from('tenant_users')
        .select('tenant_id, role, tenants!inner(agency_id)')
        .eq('profile_id', profileId),
    ]);

    if (tenantResult.error || !tenantResult.data?.agency_id) return null;
    if (agencyResult.error || tenantMembershipResult.error) return null;

    const agencyMemberships = (agencyResult.data ?? []).map(row => ({
      agencyId: String(row.agency_id),
      role: row.role as AgencyRole,
    }));
    const tenantMemberships = (tenantMembershipResult.data ?? []).flatMap(row => {
      const embedded = row.tenants as unknown;
      const agencyId = Array.isArray(embedded)
        ? (embedded[0] as { agency_id?: unknown } | undefined)?.agency_id
        : (embedded as { agency_id?: unknown } | null)?.agency_id;
      if (typeof agencyId !== 'string') return [];
      return [{ tenantId: String(row.tenant_id), agencyId, role: row.role as TenantRole }];
    });

    return {
      context: { profileId, agencyMemberships, tenantMemberships },
      tenantAgencyId: String(tenantResult.data.agency_id),
    };
  }
}
