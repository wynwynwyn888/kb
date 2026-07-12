const mockFrom = jest.fn();
jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({ from: mockFrom }),
}));

import { ForbiddenException } from '@nestjs/common';
import { GhlService } from './ghl.service';

function maybeSingleQuery(data: unknown) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
  const secondEq = jest.fn(() => ({ maybeSingle }));
  const firstEq = jest.fn(() => ({ eq: secondEq, maybeSingle }));
  return { select: jest.fn(() => ({ eq: firstEq })) };
}

describe('GhlService tenant write authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows a tenant ADMIN without consulting agency membership', async () => {
    mockFrom.mockReturnValue(maybeSingleQuery({ role: 'ADMIN' }));
    await expect(new GhlService().ensureTenantWriteAccessOrThrow('tenant-a', 'profile-a')).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it.each(['AGENT', 'VIEWER'])( 'denies tenant %s without privileged agency membership', async role => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return maybeSingleQuery({ role });
      if (table === 'tenants') return maybeSingleQuery({ agency_id: 'agency-a' });
      return maybeSingleQuery(null);
    });
    await expect(new GhlService().ensureTenantWriteAccessOrThrow('tenant-a', 'profile-a'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['OWNER', 'ADMIN'])('allows agency %s', async role => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return maybeSingleQuery(null);
      if (table === 'tenants') return maybeSingleQuery({ agency_id: 'agency-a' });
      return maybeSingleQuery({ role });
    });
    await expect(new GhlService().ensureTenantWriteAccessOrThrow('tenant-a', 'founder')).resolves.toBeUndefined();
  });

  it('denies agency OPERATOR', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_users') return maybeSingleQuery(null);
      if (table === 'tenants') return maybeSingleQuery({ agency_id: 'agency-a' });
      return maybeSingleQuery({ role: 'OPERATOR' });
    });
    await expect(new GhlService().ensureTenantWriteAccessOrThrow('tenant-a', 'operator'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
