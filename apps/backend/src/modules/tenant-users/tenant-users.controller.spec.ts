import { TenantUsersController } from './tenant-users.controller';

describe('TenantUsersController caller-scoped roster GET', () => {
  it('passes the verified actor and raw request token to the roster service', async () => {
    const listMembersForCaller = jest.fn().mockResolvedValue([]);
    const controller = new TenantUsersController({ listMembersForCaller } as never, {} as never);
    await expect(controller.findAll(' tenant-a ', { id: 'profile-a' } as never, 'jwt-a')).resolves.toEqual([]);
    expect(listMembersForCaller).toHaveBeenCalledWith('tenant-a', 'profile-a', 'jwt-a');
  });
});
