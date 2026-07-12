import { AuthorizationPolicyService } from './authorization-policy.service';
import { AuthorizationShadowService } from './authorization-shadow.service';

describe('AuthorizationShadowService safety', () => {
  const originalEnabled = process.env['AUTHORIZATION_SHADOW_ENABLED'];
  const originalTimeout = process.env['AUTHORIZATION_SHADOW_TIMEOUT_MS'];
  const originalMaximum = process.env['AUTHORIZATION_SHADOW_MAX_CONCURRENT'];

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env['AUTHORIZATION_SHADOW_ENABLED'];
    else process.env['AUTHORIZATION_SHADOW_ENABLED'] = originalEnabled;
    if (originalTimeout === undefined) delete process.env['AUTHORIZATION_SHADOW_TIMEOUT_MS'];
    else process.env['AUTHORIZATION_SHADOW_TIMEOUT_MS'] = originalTimeout;
    if (originalMaximum === undefined) delete process.env['AUTHORIZATION_SHADOW_MAX_CONCURRENT'];
    else process.env['AUTHORIZATION_SHADOW_MAX_CONCURRENT'] = originalMaximum;
    jest.restoreAllMocks();
  });

  it('is a zero-query no-op unless explicitly enabled', async () => {
    delete process.env['AUTHORIZATION_SHADOW_ENABLED'];
    const service = new AuthorizationShadowService(new AuthorizationPolicyService());
    const load = jest.spyOn(service as never, 'loadContext' as never);
    await expect(
      service.observeTenantAccess({
        profileId: 'profile-secret', tenantId: 'tenant-secret', action: 'read',
        legacyAllowed: true, source: 'test',
      }),
    ).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('never throws into the legacy request when shadow loading fails', async () => {
    process.env['AUTHORIZATION_SHADOW_ENABLED'] = 'true';
    const service = new AuthorizationShadowService(new AuthorizationPolicyService());
    jest.spyOn(service as never, 'loadContext' as never)
      .mockRejectedValue(new Error('database detail that must not be logged') as never);
    const logger = (service as unknown as { logger: { warn: (line: string) => void } }).logger;
    const warn = jest.spyOn(logger, 'warn');
    await expect(service.observeTenantAccess({
      profileId: 'profile-secret', tenantId: 'tenant-secret', action: 'read',
      legacyAllowed: true, source: 'test',
    })).resolves.toBeUndefined();
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('authorizationShadowError');
    expect(logged).not.toContain('profile-secret');
    expect(logged).not.toContain('tenant-secret');
    expect(logged).not.toContain('database detail');
  });

  it('logs a hashed disagreement without returning a replacement decision', async () => {
    process.env['AUTHORIZATION_SHADOW_ENABLED'] = 'true';
    const service = new AuthorizationShadowService(new AuthorizationPolicyService());
    jest.spyOn(service as never, 'loadContext' as never).mockResolvedValue({
      ok: true,
      context: {
        profileId: 'profile-secret',
        membershipStatus: 'complete',
        agencyMemberships: [{ agencyId: 'agency-1', role: 'MEMBER' }],
        tenantMemberships: [],
      },
      tenantAgencyId: 'agency-1',
      cache: 'miss',
    } as never);
    const logger = (service as unknown as { logger: { warn: (line: string) => void } }).logger;
    const warn = jest.spyOn(logger, 'warn');
    const result = await service.observeTenantAccess({
      profileId: 'profile-secret', tenantId: 'tenant-secret', action: 'read',
      legacyAllowed: true, source: 'legacy-check',
    });
    expect(result).toBeUndefined();
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('authorizationShadowDisagreement');
    expect(logged).toContain('"legacyAllowed":true');
    expect(logged).toContain('"shadowAllowed":false');
    expect(logged).not.toContain('profile-secret');
    expect(logged).not.toContain('tenant-secret');
  });

  it('deduplicates concurrent loads and serves the next observation from cache', async () => {
    process.env['AUTHORIZATION_SHADOW_ENABLED'] = 'true';
    const service = new AuthorizationShadowService(new AuthorizationPolicyService());
    let resolveLoad!: (value: unknown) => void;
    const deferred = new Promise(resolve => { resolveLoad = resolve; });
    const query = jest.spyOn(service as never, 'queryContext' as never).mockReturnValue(deferred as never);
    const observation = {
      profileId: 'profile-a', tenantId: 'tenant-a', action: 'read' as const,
      legacyAllowed: true, source: 'test',
    };
    const first = service.observeTenantAccess(observation);
    const second = service.observeTenantAccess(observation);
    resolveLoad({
      ok: true,
      context: {
        profileId: 'profile-a', membershipStatus: 'complete',
        agencyMemberships: [{ agencyId: 'agency-a', role: 'OWNER' }], tenantMemberships: [],
      },
      tenantAgencyId: 'agency-a', cache: 'miss',
    });
    await Promise.all([first, second]);
    await service.observeTenantAccess(observation);
    expect(query).toHaveBeenCalledTimes(1);
    expect(service.getMetricsSnapshot()).toMatchObject({
      observed: 3, match: 3, databaseLoad: 1, deduplicated: 1, cacheHit: 1,
    });
  });

  it('returns capacity immediately and keeps a timed-out load active until it settles', async () => {
    process.env['AUTHORIZATION_SHADOW_ENABLED'] = 'true';
    process.env['AUTHORIZATION_SHADOW_MAX_CONCURRENT'] = '1';
    process.env['AUTHORIZATION_SHADOW_TIMEOUT_MS'] = '100';
    const service = new AuthorizationShadowService(new AuthorizationPolicyService());
    let resolveLoad!: (value: unknown) => void;
    const deferred = new Promise(resolve => { resolveLoad = resolve; });
    jest.spyOn(service as never, 'queryContext' as never).mockReturnValue(deferred as never);

    const first = service.observeTenantAccess({
      profileId: 'profile-a', tenantId: 'tenant-a', action: 'read', legacyAllowed: true, source: 'test',
    });
    await new Promise(resolve => setImmediate(resolve));
    await service.observeTenantAccess({
      profileId: 'profile-b', tenantId: 'tenant-b', action: 'read', legacyAllowed: false, source: 'test',
    });
    await first;
    expect(service.getMetricsSnapshot()).toMatchObject({
      observed: 2, unavailable: 2, capacity: 1, timeout: 1, databaseLoad: 1,
    });
    resolveLoad({ ok: false, reason: 'query_failed' });
    await new Promise(resolve => setImmediate(resolve));
  });
});
