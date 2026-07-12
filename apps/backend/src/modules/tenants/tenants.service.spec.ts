// Focus: agency-system workspace delete protection.
// We mock only what deleteTenant needs (the initial tenants row read).

import { jest as jestGlobal } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { createMockSupabase, mockFrom } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

describe('TenantsService.deleteTenant', () => {
  let service: TenantsService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    service = new TenantsService({} as never, { get: async () => null, set: async () => {} } as never);
  });

  it('rejects deletion when target is the agency system workspace', async () => {
    mockFrom(mockSupabase, 'tenants', {
      id: 't-system',
      agency_id: 'a1',
      name: 'Agency Workspace',
      is_agency_workspace: true,
    });
    await expect(service.deleteTenant('t-system', 'profile-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects deletion when the actor is not an agency staff member', async () => {
    mockFrom(mockSupabase, 'tenants', {
      id: 't1',
      agency_id: 'a1',
      name: 'Client Workspace',
      is_agency_workspace: false,
    });
    mockFrom(mockSupabase, 'agency_users', null);
    await expect(service.deleteTenant('t1', 'profile-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TenantsService authorization shadow isolation', () => {
  it('keeps the cached legacy result final even if the observer rejects', async () => {
    const observer = {
      observeTenantAccess: jestGlobal.fn(async () => {
        throw new Error('shadow failure');
      }),
    };
    const service = new TenantsService(
      {} as never,
      { get: async () => true, set: async () => {} } as never,
      observer as never,
    );

    await expect(service.checkTenantAccess('tenant-a', 'profile-a')).resolves.toBe(true);
    await new Promise(resolve => setImmediate(resolve));
    expect(observer.observeTenantAccess).toHaveBeenCalledWith({
      profileId: 'profile-a',
      tenantId: 'tenant-a',
      action: 'read',
      legacyAllowed: true,
      source: 'TenantsService.checkTenantAccess',
    });
  });
});
