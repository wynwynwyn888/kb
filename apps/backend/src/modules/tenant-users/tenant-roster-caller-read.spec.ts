const mockInternalClient = { from: jest.fn() };
const mockCallerClient = { rpc: jest.fn() };
const mockCreateUserDatabaseClient = jest.fn(() => mockCallerClient);

jest.mock('../../lib/supabase', () => ({ getSupabaseService: () => mockInternalClient }));
jest.mock('../../lib/database/user-database-client', () => ({
  createUserDatabaseClient: (token: string) => mockCreateUserDatabaseClient(token),
}));

import { TenantUsersService } from './tenant-users.service';

function membershipQuery(data: unknown) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
  const eqSecond = jest.fn(() => ({ maybeSingle }));
  const eqFirst = jest.fn(() => ({ eq: eqSecond }));
  const select = jest.fn(() => ({ eq: eqFirst }));
  return { select };
}

describe('TenantUsersService caller-scoped roster read', () => {
  beforeEach(() => jest.clearAllMocks());

  it('authorizes internally then returns the caller-scoped RPC roster', async () => {
    mockInternalClient.from.mockReturnValue(membershipQuery({ role: 'ADMIN' }));
    mockCallerClient.rpc.mockResolvedValue({
      data: [{
        id: 'membership-a', tenant_id: 'tenant-a', profile_id: 'profile-a', role: 'ADMIN',
        email: 'admin@example.com', full_name: 'Admin',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
      }],
      error: null,
    });
    const service = new TenantUsersService({} as never);

    await expect(service.listMembersForCaller('tenant-a', 'profile-a', 'jwt-a')).resolves.toEqual([{
      id: 'membership-a', tenantId: 'tenant-a', profileId: 'profile-a', role: 'ADMIN',
      email: 'admin@example.com', fullName: 'Admin',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    }]);
    expect(mockCreateUserDatabaseClient).toHaveBeenCalledWith('jwt-a');
    expect(mockCallerClient.rpc).toHaveBeenCalledWith('list_tenant_members', { p_tenant_id: 'tenant-a' });
  });

  it('does not create a caller client when application authorization fails', async () => {
    mockInternalClient.from.mockReturnValue(membershipQuery(null));
    const hasAgencyAccess = jest.fn().mockResolvedValue(false);
    const service = new TenantUsersService({ hasAgencyAccess } as never);
    // The agency lookup also uses the internal client; return no tenant parent.
    mockInternalClient.from.mockImplementation((table: string) =>
      table === 'tenant_users' ? membershipQuery(null) : {
        select: () => ({ eq: () => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }) }),
      });

    await expect(service.listMembersForCaller('tenant-b', 'profile-a', 'jwt-a')).rejects.toThrow('Tenant not found');
    expect(mockCreateUserDatabaseClient).not.toHaveBeenCalled();
  });

  it('returns a generic error for an RPC failure', async () => {
    mockInternalClient.from.mockReturnValue(membershipQuery({ role: 'VIEWER' }));
    mockCallerClient.rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const service = new TenantUsersService({} as never);
    await expect(service.listMembersForCaller('tenant-a', 'profile-a', 'jwt-a')).rejects.toThrow(
      'Failed to list workspace members',
    );
  });
});
