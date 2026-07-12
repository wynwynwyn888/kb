const mockCallerClient = { rpc: jest.fn() };
const mockCreateUserDatabaseClient = jest.fn(() => mockCallerClient);

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({ from: jest.fn() }),
}));
jest.mock('../../lib/database/user-database-client', () => ({
  createUserDatabaseClient: (token: string) => mockCreateUserDatabaseClient(token),
}));

import { BookingSettingsService } from './booking-settings.service';

describe('BookingSettingsService caller-scoped read', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps the fixed RPC response and management decision', async () => {
    mockCallerClient.rpc.mockResolvedValue({
      data: [{
        enabled: true,
        booking_mode: 'CHECK_AVAILABILITY',
        default_ghl_calendar_id: 'cal-a',
        default_ghl_calendar_name: 'Main',
        core_fields_json: {},
        custom_fields_json: [],
        service_menu_options: null,
        max_bookings_per_slot: 1,
        internal_booking_alert_enabled: true,
        internal_booking_alert_number: '+6512345678',
        internal_booking_alert_channel: 'GHL_MESSAGE',
        internal_booking_alert_template: 'New booking',
        can_manage: true,
      }],
      error: null,
    });
    const service = new BookingSettingsService({} as never);

    await expect(service.getBookingSettingsForCaller('tenant-a', 'jwt-a')).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        defaultGhlCalendarId: 'cal-a',
        internalBookingAlertNumber: '+6512345678',
        canManage: true,
      }),
    );
    expect(mockCreateUserDatabaseClient).toHaveBeenCalledWith('jwt-a');
    expect(mockCallerClient.rpc).toHaveBeenCalledWith('get_tenant_booking_settings', {
      p_tenant_id: 'tenant-a',
    });
  });

  it('does not expose database details when the RPC fails', async () => {
    mockCallerClient.rpc.mockResolvedValue({ data: null, error: { message: 'private detail' } });
    const service = new BookingSettingsService({} as never);
    await expect(service.getBookingSettingsForCaller('tenant-a', 'jwt-a')).rejects.toThrow(
      'Could not load booking settings',
    );
  });
});
