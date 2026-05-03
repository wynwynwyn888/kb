import { jest } from '@jest/globals';
import { ConversationBookingFlowService } from './conversation-booking-flow.service';
import type { BookingPostConfirmService } from './booking-post-confirm.service';
import type { BookingSettingsService } from '../booking-settings/booking-settings.service';
import type { GhlService } from '../ghl/ghl.service';

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                contains: () => ({
                  order: () => ({
                    limit: () => ({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
      insert: () => ({ error: null }),
    }),
  }),
}));

const baseSettings = {
  enabled: true,
  bookingMode: 'CHECK_AVAILABILITY' as const,
  defaultGhlCalendarId: 'cal_1',
  defaultGhlCalendarName: 'Main',
  coreFieldsJson: {
    name: { enabled: true, required: true },
    phone: { enabled: true, required: true },
    email: { enabled: false, required: false },
    service: { enabled: true, required: true },
    preferred_date: { enabled: true, required: true },
    preferred_time: { enabled: false, required: false },
    first_visit: { enabled: false, required: false },
  },
  customFieldsJson: [],
  maxBookingsPerSlot: 1,
};

function svc(booking: BookingSettingsService, ghl: GhlService) {
  const post = { runAfterLiveBookingConfirmed: jest.fn(async () => undefined) } as unknown as BookingPostConfirmService;
  return new ConversationBookingFlowService(booking, ghl, post);
}

const slotFetchUtcNineAm = {
  slots: [
    { startTime: '2026-05-27T09:00:00.000Z', endTime: '2026-05-27T09:30:00.000Z' },
    { startTime: '2026-05-27T09:30:00.000Z', endTime: '2026-05-27T10:00:00.000Z' },
    { startTime: '2026-05-27T10:00:00.000Z', endTime: '2026-05-27T10:30:00.000Z' },
  ],
  calendarId: 'cal_1',
  error: undefined as string | undefined,
  retriedWithUserId: null,
  crmTimezoneUsed: 'UTC',
  selectedDate: '2026-05-27',
  selectedTime: '',
  startMs: 0,
  endMs: 1,
  ghlLocationId: 'loc',
};

describe('booking flow UX', () => {
  it('A: preferredTime 09:00 with matching slot — direct reserve prompt, no generic 3-option list', async () => {
    const fetchFree = jest.fn(async () => slotFetchUtcNineAm);
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText:
        'i want to book 27 May 9am morning, for hair colour, my name is quickesta, phone number 01492391, is this timing available?',
      latestInboundText:
        'i want to book 27 May 9am morning, for hair colour, my name is quickesta, phone number 01492391, is this timing available?',
      metadata: {},
      contactSnapshot: { displayName: 'Quickesta', phone: '01492391' },
    });
    expect(r.handled).toBe(true);
    if (!r.handled) return;
    const text = r.replyPlan.bubbles[0]!.text;
    expect(text.toLowerCase()).toMatch(/9:00/);
    expect(text.toLowerCase()).not.toMatch(/which one would you like/);
    expect(text.toLowerCase()).not.toMatch(/\n1\.\s/);
    expect(text.toLowerCase()).toMatch(/shall i reserve|would you like me to reserve/);
    const meta = (r.persistMetadata as { aisbp_booking?: { offeredSlots?: unknown[] } }).aisbp_booking;
    expect(meta?.offeredSlots?.length).toBe(1);
  });

  it('B: after exact-slot prompt, "yes" creates appointment at 09:00', async () => {
    const fetchFree = jest.fn(async () => slotFetchUtcNineAm);
    const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_ux' }));
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({
        client: { bookSlot },
        ghlLocationId: 'loc1',
      })),
    } as unknown as GhlService;

    const offeredSlots = [
      {
        option: 1,
        startIso: '2026-05-27T09:00:00.000Z',
        endIso: '2026-05-27T09:30:00.000Z',
        displayText: '9:00 AM',
        calendarId: 'cal_1',
      },
    ];

    const meta = {
      aisbp_booking: {
        status: 'offered_slots',
        version: 1,
        calendarId: 'cal_1',
        customerName: 'Quickesta',
        phone: '01492391',
        service: 'Hair Colour',
        preferredDate: '2026-05-27',
        preferredTime: '09:00',
        offeredSlots,
        offeredSlotsCrmTimeZone: 'UTC',
        slotDurationMinutes: 30,
      },
    };

    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'yes',
      latestInboundText: 'yes',
      metadata: meta as Record<string, unknown>,
    });
    expect(r.handled).toBe(true);
    expect(bookSlot).toHaveBeenCalled();
    const arg = (bookSlot.mock.calls[0] ?? [])[0] as { startTime?: string };
    expect(arg.startTime).toBe('2026-05-27T09:00:00.000Z');
  });

  it('C: frustration line — acknowledges and asks to reserve 9:00, no numbered slot list', async () => {
    const fetchFree = jest.fn(async () => slotFetchUtcNineAm);
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;

    const offeredSlots = [
      {
        option: 1,
        startIso: '2026-05-27T09:00:00.000Z',
        endIso: '2026-05-27T09:30:00.000Z',
        displayText: '9:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2026-05-27T09:30:00.000Z',
        endIso: '2026-05-27T10:00:00.000Z',
        displayText: '9:30 AM',
        calendarId: 'cal_1',
      },
      {
        option: 3,
        startIso: '2026-05-27T10:00:00.000Z',
        endIso: '2026-05-27T10:30:00.000Z',
        displayText: '10:00 AM',
        calendarId: 'cal_1',
      },
    ];

    const meta = {
      aisbp_booking: {
        status: 'offered_slots',
        version: 1,
        calendarId: 'cal_1',
        customerName: 'Quickesta',
        phone: '01492391',
        service: 'Hair Colour',
        preferredDate: '2026-05-27',
        preferredTime: '09:00',
        offeredSlots,
        offeredSlotsCrmTimeZone: 'UTC',
        slotDurationMinutes: 30,
      },
    };

    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'i said 9am, why u still ask me?',
      latestInboundText: 'i said 9am, why u still ask me?',
      metadata: meta as Record<string, unknown>,
    });
    expect(r.handled).toBe(true);
    if (!r.handled) return;
    const text = r.replyPlan.bubbles[0]!.text.toLowerCase();
    expect(text).toMatch(/you.*re right/);
    expect(text).toMatch(/9:00|reserve/);
    expect(text).not.toMatch(/\n1\.\s/);
    expect(text).not.toMatch(/which one would you like/);
    expect(fetchFree).not.toHaveBeenCalled();
  });

  it('D: after confirmed booking, unrelated message does not stay in booking slot flow', async () => {
    const fetchFree = jest.fn(async () => slotFetchUtcNineAm);
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;

    const meta = {
      aisbp_booking: {
        status: 'confirmed',
        version: 1,
        calendarId: 'cal_1',
        customerName: 'Quickesta',
        phone: '01492391',
        service: 'Hair Colour',
        preferredDate: '2026-05-27',
        preferredTime: '09:00',
        offeredSlots: [{ option: 1, startIso: 'x', endIso: 'x', displayText: '9:00 AM', calendarId: 'cal_1' }],
      },
    };

    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'your location pls',
      latestInboundText: 'your location pls',
      metadata: meta as Record<string, unknown>,
    });
    expect(r.handled).toBe(false);
    expect(fetchFree).not.toHaveBeenCalled();
  });
});
