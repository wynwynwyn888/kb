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
              core_fields_json: {
                name: { enabled: false, required: true },
                phone: { enabled: true, required: true },
                email: { enabled: false, required: false },
                service: { enabled: true, required: true },
                preferred_date: { enabled: true, required: true },
                preferred_time: { enabled: false, required: false },
                first_visit: { enabled: false, required: false },
              },
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

describe('BookingSettingsService invalid Ask/Required repair', () => {
  it('normalizes Ask=false Required=true to Ask=true for name', async () => {
    const ghl = {} as unknown as GhlService;
    const svc = new BookingSettingsService(ghl);
    const r = await svc.getBookingSettings('tenant-invalid-name');
    expect(r.coreFieldsJson.name).toEqual({ enabled: true, required: true });
  });
});
