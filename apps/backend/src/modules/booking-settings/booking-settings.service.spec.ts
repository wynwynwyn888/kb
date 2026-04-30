import { jest } from '@jest/globals';
import { BookingSettingsService } from './booking-settings.service';
import type { GhlService } from '../ghl/ghl.service';

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: () => ({ error: { message: 'unexpected insert in test' } }),
      update: () => ({ eq: () => ({ error: { message: 'unexpected update in test' } }) }),
    }),
  }),
}));

describe('BookingSettingsService', () => {
  it('syncCalendars delegates to GHL listCalendars', async () => {
    const listCalendars = jest.fn(async () => ({
      calendars: [{ id: 'cal_1', name: 'Main' }],
      error: undefined as string | undefined,
    }));
    const ghl = {
      createGhlClientForConnectedTenantOrThrow: jest.fn(async () => ({
        client: { listCalendars },
        ghlLocationId: 'loc_x',
      })),
    } as unknown as GhlService;

    const svc = new BookingSettingsService(ghl);
    const r = await svc.syncCalendars('tenant-1', 'profile-1');

    expect(ghl.createGhlClientForConnectedTenantOrThrow).toHaveBeenCalledWith('tenant-1', 'profile-1');
    expect(listCalendars).toHaveBeenCalled();
    expect(r.calendars).toEqual([{ id: 'cal_1', name: 'Main' }]);
    expect(r.syncedAt).toMatch(/^\d{4}-/);
  });

  it('testSlots delegates to getFreeSlots', async () => {
    const getFreeSlots = jest.fn(async () => ({
      slots: [{ startTime: '2026-04-29T10:00:00Z', endTime: '2026-04-29T10:30:00Z' }],
      dateKeys: [] as string[],
      shapeSummary: 'nestedArrayField',
      httpStatus: 200,
      error: undefined as string | undefined,
    }));

    const getCalendar = jest.fn(async () => ({ summary: { teamMemberUserIds: [] as string[] } }));

    const ghl = {
      createGhlClientForConnectedTenantOrThrow: jest.fn(async () => ({
        client: { getFreeSlots, getCalendar },
        ghlLocationId: 'loc_x',
      })),
    } as unknown as GhlService;

    const svc = new BookingSettingsService(ghl);

    jest.spyOn(svc, 'getBookingSettings').mockResolvedValue({
      enabled: true,
      bookingMode: 'CHECK_AVAILABILITY',
      defaultGhlCalendarId: 'cal_9',
      defaultGhlCalendarName: 'Main',
      coreFieldsJson: {
        name: { enabled: false, required: false },
        phone: { enabled: false, required: false },
        email: { enabled: false, required: false },
        service: { enabled: false, required: false },
        preferred_date: { enabled: false, required: false },
        preferred_time: { enabled: false, required: false },
        first_visit: { enabled: false, required: false },
      },
      customFieldsJson: [],
      maxBookingsPerSlot: 1,
    });

    const r = await svc.testSlots('tenant-1', 'profile-1', {});
    expect(getFreeSlots).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'cal_9',
        startDateMs: expect.any(Number),
        endDateMs: expect.any(Number),
      }),
    );
    expect(r.slots).toHaveLength(1);
  });
});
