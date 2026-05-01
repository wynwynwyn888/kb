import { jest } from '@jest/globals';
import { BookingSettingsService } from './booking-settings.service';
import type { GhlService } from '../ghl/ghl.service';

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              enabled: true,
              booking_mode: 'CHECK_AVAILABILITY',
              default_ghl_calendar_id: 'cal_9',
              default_ghl_calendar_name: 'Main',
              core_fields_json: {},
              custom_fields_json: [],
              max_bookings_per_slot: 1,
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

describe('BookingSettingsService live core field normalization', () => {
  it('defaults service, preferred date/time, name, phone as required when live and no core fields are enabled', async () => {
    const ghl = {
      createGhlClientForConnectedTenantOrThrow: jest.fn(),
    } as unknown as GhlService;
    const svc = new BookingSettingsService(ghl);
    const r = await svc.getBookingSettings('tenant-live-defaults');
    expect(r.coreFieldsJson.service).toEqual({ enabled: true, required: true });
    expect(r.coreFieldsJson.preferred_date).toEqual({ enabled: true, required: true });
    expect(r.coreFieldsJson.preferred_time).toEqual({ enabled: true, required: true });
    expect(r.coreFieldsJson.name).toEqual({ enabled: true, required: true });
    expect(r.coreFieldsJson.phone).toEqual({ enabled: true, required: true });
    expect(r.coreFieldsJson.email?.enabled).toBe(false);
    expect(r.coreFieldsJson.first_visit?.enabled).toBe(false);
  });
});
