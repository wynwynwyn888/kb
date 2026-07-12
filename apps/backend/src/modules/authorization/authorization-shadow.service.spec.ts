import { AuthorizationPolicyService } from './authorization-policy.service';
import { AuthorizationShadowService } from './authorization-shadow.service';

describe('AuthorizationShadowService safety', () => {
  const originalEnabled = process.env['AUTHORIZATION_SHADOW_ENABLED'];

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env['AUTHORIZATION_SHADOW_ENABLED'];
    else process.env['AUTHORIZATION_SHADOW_ENABLED'] = originalEnabled;
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
      context: {
        profileId: 'profile-secret',
        agencyMemberships: [{ agencyId: 'agency-1', role: 'MEMBER' }],
        tenantMemberships: [],
      },
      tenantAgencyId: 'agency-1',
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
});
