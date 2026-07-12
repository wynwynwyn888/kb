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

type LoadFailure = 'tenant_not_found' | 'query_failed' | 'timeout' | 'capacity';
type LoadResult =
  | { ok: true; context: AccessContext; tenantAgencyId: string; cache: 'hit' | 'miss' | 'deduplicated' }
  | { ok: false; reason: LoadFailure };

export interface AuthorizationShadowMetrics {
  observed: number;
  match: number;
  disagreement: number;
  unavailable: number;
  error: number;
  timeout: number;
  capacity: number;
  cacheHit: number;
  deduplicated: number;
  databaseLoad: number;
}

function enabled(): boolean {
  return String(process.env['AUTHORIZATION_SHADOW_ENABLED'] ?? '').trim().toLowerCase() === 'true';
}

function logMatches(): boolean {
  return String(process.env['AUTHORIZATION_SHADOW_LOG_MATCHES'] ?? '').trim().toLowerCase() === 'true';
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function safeId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function emptyMetrics(): AuthorizationShadowMetrics {
  return {
    observed: 0, match: 0, disagreement: 0, unavailable: 0, error: 0,
    timeout: 0, capacity: 0, cacheHit: 0, deduplicated: 0, databaseLoad: 0,
  };
}

@Injectable()
export class AuthorizationShadowService {
  private readonly logger = new Logger(AuthorizationShadowService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: LoadResult & { ok: true } }>();
  private readonly inFlight = new Map<string, Promise<LoadResult>>();
  private readonly metrics = emptyMetrics();
  private activeDatabaseLoads = 0;

  constructor(private readonly policy: AuthorizationPolicyService) {}

  getMetricsSnapshot(): AuthorizationShadowMetrics {
    return { ...this.metrics };
  }

  /** Observation only: never returns a replacement authorization decision. */
  async observeTenantAccess(observation: TenantShadowObservation): Promise<void> {
    if (!enabled()) return;
    this.metrics.observed += 1;
    try {
      const loaded = await this.loadContext(observation.profileId, observation.tenantId);
      if (!loaded.ok) {
        this.metrics.unavailable += 1;
        if (loaded.reason === 'timeout') this.metrics.timeout += 1;
        if (loaded.reason === 'capacity') this.metrics.capacity += 1;
        this.logger.warn(`authorizationShadowUnavailable ${JSON.stringify({
          source: observation.source,
          action: observation.action,
          profileHash: safeId(observation.profileId),
          tenantHash: safeId(observation.tenantId),
          reason: loaded.reason,
        })}`);
        this.maybeLogSummary();
        return;
      }
      if (loaded.cache === 'hit') this.metrics.cacheHit += 1;
      if (loaded.cache === 'deduplicated') this.metrics.deduplicated += 1;
      if (loaded.context.membershipStatus !== 'complete') {
        this.metrics.unavailable += 1;
        this.logger.warn(`authorizationShadowUnavailable ${JSON.stringify({
          source: observation.source,
          action: observation.action,
          profileHash: safeId(observation.profileId),
          tenantHash: safeId(observation.tenantId),
          reason: 'context_incomplete',
        })}`);
        this.maybeLogSummary();
        return;
      }
      const shadow = this.policy.decideTenantAccess(
        loaded.context, observation.tenantId, loaded.tenantAgencyId, observation.action,
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
        this.metrics.disagreement += 1;
        this.logger.warn(`authorizationShadowDisagreement ${JSON.stringify(payload)}`);
      } else {
        this.metrics.match += 1;
        if (logMatches()) this.logger.log(`authorizationShadowMatch ${JSON.stringify(payload)}`);
      }
      this.maybeLogSummary();
    } catch (error) {
      this.metrics.error += 1;
      this.logger.warn(`authorizationShadowError ${JSON.stringify({
        source: observation.source,
        action: observation.action,
        profileHash: safeId(observation.profileId),
        tenantHash: safeId(observation.tenantId),
        errorType: error instanceof Error ? error.name : 'unknown',
      })}`);
      this.maybeLogSummary();
    }
  }

  private maybeLogSummary(): void {
    const every = boundedInteger('AUTHORIZATION_SHADOW_SUMMARY_EVERY', 100, 10, 10_000);
    if (this.metrics.observed % every === 0) {
      this.logger.log(`authorizationShadowSummary ${JSON.stringify(this.getMetricsSnapshot())}`);
    }
  }

  private async loadContext(profileId: string, tenantId: string): Promise<LoadResult> {
    const key = `${profileId}\0${tenantId}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return { ...cached.value, cache: 'hit' };
    if (cached) this.cache.delete(key);

    const existing = this.inFlight.get(key);
    if (existing) {
      const result = await this.withTimeout(existing);
      return result.ok ? { ...result, cache: 'deduplicated' } : result;
    }

    const maximum = boundedInteger('AUTHORIZATION_SHADOW_MAX_CONCURRENT', 8, 1, 32);
    if (this.activeDatabaseLoads >= maximum) return { ok: false, reason: 'capacity' };

    this.activeDatabaseLoads += 1;
    this.metrics.databaseLoad += 1;
    const databaseLoad = this.queryContext(profileId, tenantId)
      .then(result => {
        if (result.ok) {
          const ttl = boundedInteger('AUTHORIZATION_SHADOW_CACHE_TTL_MS', 15_000, 1_000, 60_000);
          const value = { ...result, cache: 'miss' as const };
          this.storeCache(key, value, ttl);
          return value;
        }
        return result;
      })
      .catch((): LoadResult => ({ ok: false, reason: 'query_failed' }))
      .finally(() => {
        this.activeDatabaseLoads -= 1;
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, databaseLoad);
    return this.withTimeout(databaseLoad);
  }

  private storeCache(key: string, value: LoadResult & { ok: true }, ttl: number): void {
    const maximum = boundedInteger('AUTHORIZATION_SHADOW_CACHE_MAX_ENTRIES', 1_000, 10, 10_000);
    const now = Date.now();
    for (const [cachedKey, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(cachedKey);
    }
    while (this.cache.size >= maximum) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: now + ttl, value });
  }

  private async withTimeout(promise: Promise<LoadResult>): Promise<LoadResult> {
    const timeoutMs = boundedInteger('AUTHORIZATION_SHADOW_TIMEOUT_MS', 1_500, 100, 5_000);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<LoadResult>(resolve => {
          timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async queryContext(profileId: string, tenantId: string): Promise<LoadResult> {
    const supabase = getSupabaseService();
    const [tenantResult, agencyResult, tenantMembershipResult] = await Promise.all([
      supabase.from('tenants').select('agency_id').eq('id', tenantId).maybeSingle(),
      supabase.from('agency_users').select('agency_id, role').eq('profile_id', profileId),
      supabase.from('tenant_users').select('tenant_id, role, tenants!inner(agency_id)').eq('profile_id', profileId),
    ]);
    if (tenantResult.error || !tenantResult.data?.agency_id) {
      return { ok: false, reason: tenantResult.error ? 'query_failed' : 'tenant_not_found' };
    }
    if (agencyResult.error || tenantMembershipResult.error) return { ok: false, reason: 'query_failed' };

    const agencyMemberships = (agencyResult.data ?? []).map(row => ({
      agencyId: String(row.agency_id), role: row.role as AgencyRole,
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
      ok: true,
      context: { profileId, membershipStatus: 'complete', agencyMemberships, tenantMemberships },
      tenantAgencyId: String(tenantResult.data.agency_id),
      cache: 'miss',
    };
  }
}
