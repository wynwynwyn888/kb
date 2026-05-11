import { jest as jestGlobal } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { GhlService } from './ghl.service';

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: jestGlobal.fn(),
}));

jestGlobal.mock('@aisbp/ghl-client', () => ({
  createGhlClient: jestGlobal.fn(),
}));

jestGlobal.mock('../../lib/encryption', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => String(s).replace(/^enc:/, ''),
  maskToken: () => '***',
  safeLog: (x: unknown) => JSON.stringify(x),
}));

import { getSupabaseService } from '../../lib/supabase';
import { createGhlClient } from '@aisbp/ghl-client';

function tenantUsersMember() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({ single: async () => ({ data: { role: 'ADMIN' }, error: null }) }),
      }),
    }),
  };
}

function ghlAssertConnectedConflict() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          neq: jestGlobal.fn().mockResolvedValue({ data: [{ tenant_id: 'other-tenant' }], error: null }),
        }),
      }),
    }),
  };
}

function ghlAssertNoConflict() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          neq: jestGlobal.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  };
}

function ghlExistingRowEmpty() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: jestGlobal.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
  };
}

function ghlUpsertSuccess(ghlLocationId = 'loc-mirror') {
  return {
    upsert: () => ({
      select: () => ({
        single: async () => ({
          data: {
            status: 'CONNECTED',
            ghl_location_id: ghlLocationId,
            verified_at: new Date().toISOString(),
            last_health_check_at: new Date().toISOString(),
            last_error: null,
            metadata: {},
          },
          error: null,
        }),
      }),
    }),
  };
}

describe('GhlService.saveConnection location guards', () => {
  const mockFrom = jestGlobal.fn();

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    (getSupabaseService as jestGlobal.Mock).mockReturnValue({ from: mockFrom });
    (createGhlClient as jestGlobal.Mock).mockReturnValue({
      verifyConnection: jestGlobal.fn(async () => ({ valid: true })),
      getLocationInfo: jestGlobal.fn(async () => ({ name: 'L', accountId: 'a', id: 'loc', status: 'ok' })),
    });
  });

  it('throws Conflict when another workspace already has CONNECTED CRM for this location', async () => {
    let ghlConnCalls = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return tenantUsersMember();
      if (table === 'tenant_ghl_connections') {
        ghlConnCalls += 1;
        if (ghlConnCalls === 1) return ghlAssertConnectedConflict();
        return ghlExistingRowEmpty();
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { name: 'Other Shop' }, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const svc = new GhlService();
    await expect(
      svc.saveConnection('tenant-a', 'profile-1', { ghlLocationId: 'loc-x', privateIntegrationToken: 'tok' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws Conflict when another tenant still has legacy tenants.ghl_location_id for this location', async () => {
    let ghlConnCalls = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return tenantUsersMember();
      if (table === 'tenant_ghl_connections') {
        ghlConnCalls += 1;
        if (ghlConnCalls === 1) return ghlAssertNoConflict();
        return ghlExistingRowEmpty();
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'stale-other', name: 'Stale Co' },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const svc = new GhlService();
    await expect(
      svc.saveConnection('tenant-a', 'profile-1', { ghlLocationId: 'loc-x', privateIntegrationToken: 'tok' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates tenants.ghl_location_id mirror after successful upsert', async () => {
    let ghlConnCalls = 0;
    const tenantUpdates: unknown[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return tenantUsersMember();
      if (table === 'tenant_ghl_connections') {
        ghlConnCalls += 1;
        if (ghlConnCalls === 1) return ghlAssertNoConflict();
        if (ghlConnCalls === 2) return ghlExistingRowEmpty();
        return ghlUpsertSuccess('loc-mirror');
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          update: (payload: unknown) => {
            tenantUpdates.push(payload);
            return { eq: () => ({ error: null }) };
          },
        };
      }
      return {};
    });

    const svc = new GhlService();
    await svc.saveConnection('tenant-a', 'profile-1', { ghlLocationId: 'loc-mirror', privateIntegrationToken: 'tok' });
    expect(
      tenantUpdates.some(
        (u) => typeof u === 'object' && u !== null && (u as { ghl_location_id?: string }).ghl_location_id === 'loc-mirror',
      ),
    ).toBe(true);
  });
});

describe('GhlService disconnect → reconnect transfer (same GHL location)', () => {
  const mockFrom = jestGlobal.fn();

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    (getSupabaseService as jestGlobal.Mock).mockReturnValue({ from: mockFrom });
    (createGhlClient as jestGlobal.Mock).mockReturnValue({
      verifyConnection: jestGlobal.fn(async () => ({ valid: true })),
      getLocationInfo: jestGlobal.fn(async () => ({ name: 'Loc X', accountId: 'a', id: 'loc-x', status: 'ok' })),
    });
  });

  it('deleteConnection removes row and issues tenant mirror clear scoped to connection location', async () => {
    let ghlCalls = 0;
    const mirrorEqPairs: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return tenantUsersMember();
      if (table === 'tenant_ghl_connections') {
        ghlCalls += 1;
        if (ghlCalls === 1) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { ghl_location_id: 'loc-x' }, error: null }),
              }),
            }),
          };
        }
        return {
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === 'tenants') {
        return {
          update: (payload: unknown) => {
            expect((payload as { ghl_location_id?: unknown }).ghl_location_id).toBeNull();
            return {
              eq: (c1: string, v1: unknown) => {
                mirrorEqPairs.push(`${c1}=${v1}`);
                return {
                  eq: (c2: string, v2: unknown) => {
                    mirrorEqPairs.push(`${c2}=${v2}`);
                    return { error: null };
                  },
                };
              },
            };
          },
        };
      }
      return {};
    });

    await new GhlService().deleteConnection('workspace-a', 'profile-1');
    expect(ghlCalls).toBe(2);
    expect(mirrorEqPairs).toEqual(['id=workspace-a', 'ghl_location_id=loc-x']);
  });

  it('deleteConnection does not tenant-update when no stored connection location', async () => {
    let ghlCalls = 0;
    let tenantUpdateCalls = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return tenantUsersMember();
      if (table === 'tenant_ghl_connections') {
        ghlCalls += 1;
        if (ghlCalls === 1) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        return {
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === 'tenants') {
        return {
          update: () => {
            tenantUpdateCalls += 1;
            return { eq: () => ({ eq: () => ({ error: null }) }) };
          },
        };
      }
      return {};
    });

    await new GhlService().deleteConnection('workspace-a', 'profile-1');
    expect(tenantUpdateCalls).toBe(0);
  });

  it('saveConnection succeeds for workspace B to same location X when no other CONNECTED row and no stale legacy tenant', async () => {
    let ghlConnCalls = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return tenantUsersMember();
      if (table === 'tenant_ghl_connections') {
        ghlConnCalls += 1;
        if (ghlConnCalls === 1) return ghlAssertNoConflict();
        if (ghlConnCalls === 2) return ghlExistingRowEmpty();
        return ghlUpsertSuccess('loc-x');
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ error: null }) }),
        };
      }
      return {};
    });

    const svc = new GhlService();
    const r = await svc.saveConnection('workspace-b', 'profile-1', {
      ghlLocationId: 'loc-x',
      privateIntegrationToken: 'tok-b',
    });
    expect(r.ghlLocationId).toBe('loc-x');
    expect(r.isConnected).toBe(true);
  });
});
