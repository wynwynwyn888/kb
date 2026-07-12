import { BookingSettingsController } from './booking-settings.controller';

describe('BookingSettingsController authorization split', () => {
  const user = { id: 'profile-a' } as never;

  it('authorizes GET first and passes only the raw caller token to the caller read', async () => {
    const booking = { getBookingSettingsForCaller: jest.fn().mockResolvedValue({ enabled: false }) };
    const ghl = { ensureTenantAccessOrThrow: jest.fn().mockResolvedValue(undefined) };
    const controller = new BookingSettingsController(booking as never, ghl as never);

    await controller.get('tenant-a', user, 'jwt-a');
    expect(ghl.ensureTenantAccessOrThrow).toHaveBeenCalledWith('tenant-a', 'profile-a');
    expect(booking.getBookingSettingsForCaller).toHaveBeenCalledWith('tenant-a', 'jwt-a');
  });

  it('requires write access before PATCH and returns a caller-scoped response', async () => {
    const booking = {
      patchBookingSettings: jest.fn().mockResolvedValue({}),
      getBookingSettingsForCaller: jest.fn().mockResolvedValue({ canManage: true }),
    };
    const ghl = { ensureTenantWriteAccessOrThrow: jest.fn().mockResolvedValue(undefined) };
    const controller = new BookingSettingsController(booking as never, ghl as never);

    await expect(controller.patch('tenant-a', user, 'jwt-a', { enabled: true })).resolves.toEqual({
      canManage: true,
    });
    expect(ghl.ensureTenantWriteAccessOrThrow).toHaveBeenCalledWith('tenant-a', 'profile-a');
    expect(booking.patchBookingSettings).toHaveBeenCalledWith('tenant-a', { enabled: true });
    expect(booking.getBookingSettingsForCaller).toHaveBeenCalledWith('tenant-a', 'jwt-a');
  });

  it.each(['syncCalendars', 'testCalendar', 'testSlots', 'probeFreeSlots'] as const)(
    'requires write access for %s',
    async method => {
      const booking = {
        [method]: jest.fn().mockResolvedValue({}),
      };
      const ghl = { ensureTenantWriteAccessOrThrow: jest.fn().mockResolvedValue(undefined) };
      const controller = new BookingSettingsController(booking as never, ghl as never);
      if (method === 'syncCalendars') await controller.syncCalendars('tenant-a', user);
      else await (controller[method] as never)('tenant-a', user, {});
      expect(ghl.ensureTenantWriteAccessOrThrow).toHaveBeenCalledWith('tenant-a', 'profile-a');
    },
  );
});
