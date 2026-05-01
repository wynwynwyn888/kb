import { jest } from '@jest/globals';
import {
  ConversationBookingFlowService,
  isBookingFlowSupportedInboundText,
} from './conversation-booking-flow.service';
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
  return new ConversationBookingFlowService(booking, ghl);
}

describe('isBookingFlowSupportedInboundText', () => {
  it('is false when both texts are empty or whitespace', () => {
    expect(isBookingFlowSupportedInboundText('', '')).toBe(false);
    expect(isBookingFlowSupportedInboundText('  ', '\t')).toBe(false);
  });

  it('is true when either side has non-whitespace', () => {
    expect(isBookingFlowSupportedInboundText('2', '')).toBe(true);
    expect(isBookingFlowSupportedInboundText('', 'book')).toBe(true);
  });
});

describe('ConversationBookingFlowService', () => {
  it('skips before settings when inbound text is empty', async () => {
    const booking = { getBookingSettings: jest.fn(async () => baseSettings) } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: '   ',
      latestInboundText: '',
      metadata: {},
    });
    expect(r.handled).toBe(false);
    expect(booking.getBookingSettings).not.toHaveBeenCalled();
  });

  it('runs on SMS with booking intent', async () => {
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'I want to book tomorrow',
      latestInboundText: 'I want to book tomorrow',
      metadata: {},
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/name|phone/);
    }
  });

  it('runs on WHATSAPP with booking intent', async () => {
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'WHATSAPP',
      combinedInboundText: 'I want to book tomorrow',
      latestInboundText: 'I want to book tomorrow',
      metadata: {},
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/name|phone/);
    }
  });

  it('runs on unknown GHL channel label when inbound text exists', async () => {
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'PROVIDER_WA_AS_SMS',
      combinedInboundText: 'book haircut tomorrow',
      latestInboundText: 'book haircut tomorrow',
      metadata: {},
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/name|phone/);
    }
  });

  it('skips live booking when mode is COLLECT_DETAILS_ONLY', async () => {
    const booking = {
      getBookingSettings: jest.fn(async () => ({ ...baseSettings, bookingMode: 'COLLECT_DETAILS_ONLY' as const })),
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'I want to book an appointment tomorrow',
      latestInboundText: 'I want to book an appointment tomorrow',
      metadata: {},
    });
    expect(r.handled).toBe(false);
  });

  it('when booking disabled but user shows interest, returns team handoff', async () => {
    const booking = {
      getBookingSettings: jest.fn(async () => ({ ...baseSettings, enabled: false })),
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'I want to book an appointment tomorrow',
      latestInboundText: 'I want to book an appointment tomorrow',
      metadata: {},
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/isn't switched on/i);
    }
  });

  it('collects missing required fields before slots', async () => {
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'WHATSAPP',
      combinedInboundText: 'book haircut tomorrow',
      latestInboundText: 'book haircut tomorrow',
      metadata: {},
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/name|phone/);
    }
  });

  it('parses hair colour, May 21, and 9am from first message', async () => {
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'I want to book hair colour on 21 May around 9am',
      latestInboundText: 'I want to book hair colour on 21 May around 9am',
      metadata: {},
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      const meta = (r.persistMetadata as { aisbp_booking?: Record<string, unknown> }).aisbp_booking;
      expect(meta?.['service']).toMatch(/hair colour/i);
      expect(meta?.['preferredDate']).toBe('2026-05-21');
      expect(meta?.['preferredTime']).toBe('09:00');
    }
  });

  it('optional name and phone do not block slot lookup when core details are present', async () => {
    const fetchFree = jest.fn(async () => ({
      slots: [
        { startTime: '2026-05-21T09:00:00.000Z', endTime: '2026-05-21T09:30:00.000Z' },
        { startTime: '2026-05-21T09:30:00.000Z', endTime: '2026-05-21T10:00:00.000Z' },
        { startTime: '2026-05-21T10:00:00.000Z', endTime: '2026-05-21T10:30:00.000Z' },
      ],
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2026-05-21',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    }));
    const core = {
      ...baseSettings.coreFieldsJson,
      name: { enabled: true, required: false },
      phone: { enabled: true, required: false },
    };
    const booking = {
      getBookingSettings: jest.fn(async () => ({ ...baseSettings, coreFieldsJson: core })),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'I want to book hair colour on 21 May around 9am',
      latestInboundText: 'I want to book hair colour on 21 May around 9am',
      metadata: {},
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(fetchFree).toHaveBeenCalled();
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/1\./);
    }
  });

  it('saves pending name reply "Lucy" and proceeds to slots when other required fields are set', async () => {
    const fetchFree = jest.fn(async () => ({
      slots: [
        { startTime: '2026-05-21T09:00:00.000Z', endTime: '2026-05-21T09:30:00.000Z' },
        { startTime: '2026-05-21T09:30:00.000Z', endTime: '2026-05-21T10:00:00.000Z' },
        { startTime: '2026-05-21T10:00:00.000Z', endTime: '2026-05-21T10:30:00.000Z' },
      ],
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2026-05-21',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    }));
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const meta = {
      aisbp_booking: {
        status: 'collecting_details',
        version: 1,
        calendarId: 'cal_1',
        service: 'Hair colour',
        preferredDate: '2026-05-21',
        preferredTime: '09:00',
        phone: '+15551234567',
        pendingFieldId: 'name',
      },
    };
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'Lucy',
      latestInboundText: 'Lucy',
      metadata: meta as Record<string, unknown>,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      const out = (r.persistMetadata as { aisbp_booking?: Record<string, unknown> }).aisbp_booking;
      expect(out?.['customerName']).toBe('Lucy');
      expect(out?.['pendingFieldId']).toBeUndefined();
      expect(fetchFree).toHaveBeenCalled();
    }
  });

  it('saves "i told u Lucy" as name when pendingFieldId is name', async () => {
    const fetchFree = jest.fn(async () => ({
      slots: [
        { startTime: '2026-05-21T09:00:00.000Z', endTime: '2026-05-21T09:30:00.000Z' },
        { startTime: '2026-05-21T09:30:00.000Z', endTime: '2026-05-21T10:00:00.000Z' },
      ],
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2026-05-21',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    }));
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const meta = {
      aisbp_booking: {
        status: 'collecting_details',
        version: 1,
        calendarId: 'cal_1',
        service: 'Hair colour',
        preferredDate: '2026-05-21',
        preferredTime: '09:00',
        phone: '+15551234567',
        pendingFieldId: 'name',
      },
    };
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'i told u Lucy',
      latestInboundText: 'i told u Lucy',
      metadata: meta as Record<string, unknown>,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      const out = (r.persistMetadata as { aisbp_booking?: Record<string, unknown> }).aisbp_booking;
      expect(out?.['customerName']).toBe('Lucy');
    }
  });

  it('offers up to three slots when details complete', async () => {
    const fetchFree = jest.fn(async () => ({
      slots: [
        { startTime: '2026-05-10T10:00:00.000Z', endTime: '2026-05-10T10:30:00.000Z' },
        { startTime: '2026-05-10T10:30:00.000Z', endTime: '2026-05-10T11:00:00.000Z' },
        { startTime: '2026-05-10T11:00:00.000Z', endTime: '2026-05-10T11:30:00.000Z' },
        { startTime: '2026-05-10T11:30:00.000Z', endTime: '2026-05-10T12:00:00.000Z' },
      ],
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2026-05-10',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    }));
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;

    const meta = {
      aisbp_booking: {
        status: 'collecting_details',
        version: 1,
        calendarId: 'cal_1',
        customerName: 'Alex',
        phone: '+15551234567',
        service: 'Haircut',
        preferredDate: '2026-05-10',
      },
    };

    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'WHATSAPP',
      combinedInboundText: 'ok',
      latestInboundText: 'ok',
      metadata: meta as Record<string, unknown>,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(fetchFree).toHaveBeenCalled();
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/1\./);
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/2\./);
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/3\./);
    }
  });

  it('continues active offered_slots session on SMS when latest message is just "2"', async () => {
    const slotRows = [
      { startTime: '2026-05-10T10:00:00.000Z', endTime: '2026-05-10T10:30:00.000Z' },
      { startTime: '2026-05-10T11:00:00.000Z', endTime: '2026-05-10T11:30:00.000Z' },
      { startTime: '2026-05-10T11:30:00.000Z', endTime: '2026-05-10T12:00:00.000Z' },
    ];
    const fetchFree = jest.fn(async () => ({
      slots: slotRows,
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2026-05-10',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    }));
    const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_123' }));
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
        startIso: '2026-05-10T10:00:00.000Z',
        endIso: '2026-05-10T10:30:00.000Z',
        displayText: '6:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2026-05-10T11:00:00.000Z',
        endIso: '2026-05-10T11:30:00.000Z',
        displayText: '7:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 3,
        startIso: '2026-05-10T11:30:00.000Z',
        endIso: '2026-05-10T12:00:00.000Z',
        displayText: '7:30 AM',
        calendarId: 'cal_1',
      },
    ];

    const meta = {
      aisbp_booking: {
        status: 'offered_slots',
        version: 1,
        calendarId: 'cal_1',
        customerName: 'Alex',
        phone: '+15551234567',
        service: 'Haircut',
        preferredDate: '2026-05-10',
        offeredSlots,
        slotDurationMinutes: 30,
      },
    };

    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: '2',
      latestInboundText: '2',
      metadata: meta as Record<string, unknown>,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(bookSlot).toHaveBeenCalled();
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/confirmed/);
    }
  });
});
