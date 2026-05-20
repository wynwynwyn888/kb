import { jest } from '@jest/globals';
import {
  ConversationBookingFlowService,
  isBookingFlowSupportedInboundText,
} from './conversation-booking-flow.service';
import type { BookingPostConfirmService } from './booking-post-confirm.service';
import type { BookingSettingsService } from '../booking-settings/booking-settings.service';
import type { GhlService } from '../ghl/ghl.service';
import type { AisbpOfferedSlot } from './conversation-booking-state';

const capturedActionIntentInserts: unknown[] = [];

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: (table: string) => {
      if (table === 'action_intents') {
        return {
          insert: (payload: unknown) => {
            capturedActionIntentInserts.push(payload);
            return { error: null };
          },
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
        };
      }
      return {
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
      };
    },
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

/** All core fields optional Ask — matches production “Ask without Required” UX. */
const allOptionalAskSettings = {
  enabled: true,
  bookingMode: 'CHECK_AVAILABILITY' as const,
  defaultGhlCalendarId: 'cal_1',
  defaultGhlCalendarName: 'Main',
  coreFieldsJson: {
    name: { enabled: true, required: false },
    phone: { enabled: true, required: false },
    email: { enabled: false, required: false },
    service: { enabled: true, required: false },
    preferred_date: { enabled: true, required: false },
    preferred_time: { enabled: true, required: false },
    first_visit: { enabled: false, required: false },
  },
  customFieldsJson: [],
  maxBookingsPerSlot: 1,
};

function svc(booking: BookingSettingsService, ghl: GhlService) {
  const post = { runAfterLiveBookingConfirmed: jest.fn(async () => undefined) } as unknown as BookingPostConfirmService;
  return new ConversationBookingFlowService(booking, ghl, post);
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

type FlowBareSlot = ConversationBookingFlowService & {
  isBareOfferedSlotIndexLine(latestInboundText: string, offeredSlots?: AisbpOfferedSlot[]): boolean;
};

describe('isBareOfferedSlotIndexLine', () => {
  const bare = (flow: ConversationBookingFlowService) =>
    (flow as unknown as FlowBareSlot).isBareOfferedSlotIndexLine.bind(flow);

  it('returns false when offeredSlots is undefined (no crash)', () => {
    const booking = { getBookingSettings: jest.fn(async () => baseSettings) } as unknown as BookingSettingsService;
    const flow = svc(booking, {} as GhlService);
    expect(bare(flow)('3', undefined)).toBe(false);
  });

  it('returns false when offeredSlots is empty', () => {
    const booking = { getBookingSettings: jest.fn(async () => baseSettings) } as unknown as BookingSettingsService;
    const flow = svc(booking, {} as GhlService);
    expect(bare(flow)('3', [])).toBe(false);
  });

  it('returns true when message is exactly 3 and option 3 exists', () => {
    const booking = { getBookingSettings: jest.fn(async () => baseSettings) } as unknown as BookingSettingsService;
    const flow = svc(booking, {} as GhlService);
    const slots: AisbpOfferedSlot[] = [
      {
        option: 3,
        startIso: '2026-05-29T07:00:00.000Z',
        endIso: '2026-05-29T07:30:00.000Z',
        displayText: '3:00 PM',
        calendarId: 'cal_1',
      },
    ];
    expect(bare(flow)('3', slots)).toBe(true);
  });

  it('returns false when option digit has no matching slot', () => {
    const booking = { getBookingSettings: jest.fn(async () => baseSettings) } as unknown as BookingSettingsService;
    const flow = svc(booking, {} as GhlService);
    const slots: AisbpOfferedSlot[] = [
      {
        option: 1,
        startIso: '2026-05-29T04:00:00.000Z',
        endIso: '2026-05-29T04:30:00.000Z',
        displayText: '12:00 PM',
        calendarId: 'cal_1',
      },
    ];
    expect(bare(flow)('3', slots)).toBe(false);
  });
});

describe('ConversationBookingFlowService', () => {
  beforeEach(() => {
    capturedActionIntentInserts.length = 0;
  });

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
    const fetchFree = jest.fn(async () => ({
      slots: [],
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '',
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
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/contact name|mobile number/);
      expect(fetchFree).not.toHaveBeenCalled();
    }
  });

  it('parses hair colour, May 21, and 9am from first message; batches contact fields before slots', async () => {
    const fetchFree = jest.fn(async () => ({
      slots: [],
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
      getBookingSettings: jest.fn(async () => allOptionalAskSettings),
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
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/Contact name/i);
      expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/skip this if you prefer/i);
      expect(fetchFree).not.toHaveBeenCalled();
      const meta = (r.persistMetadata as { aisbp_booking?: Record<string, unknown> }).aisbp_booking;
      expect(meta?.['service']).toMatch(/hair colour/i);
      expect(meta?.['preferredDate']).toBe('2026-05-21');
      expect(meta?.['preferredTime']).toBe('09:00');
    }
  });

  it('batches contact fields before slots when time is locked and phone is still required', async () => {
    const fetchFree = jest.fn(async () => ({
      slots: [],
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2030-05-10',
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
        customerName: 'Sam',
        service: 'Haircut',
        preferredDate: '2030-05-10',
        preferredTime: '15:00',
      },
    };
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct_known',
      channel: 'SMS',
      combinedInboundText: 'I want to book',
      latestInboundText: 'I want to book',
      metadata: meta as Record<string, unknown>,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/Mobile number/i);
      expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/skip this if you prefer/i);
      expect(fetchFree).not.toHaveBeenCalled();
    }
  });

  it('contactId alone does not satisfy name when snapshot has no display name', async () => {
    const fetchFree = jest.fn();
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {} as unknown as GhlService;
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ghl_contact_xyz',
      channel: 'SMS',
      combinedInboundText: 'book haircut tomorrow',
      latestInboundText: 'book haircut tomorrow',
      metadata: {},
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/Contact name|booking name/i);
      expect(fetchFree).not.toHaveBeenCalled();
    }
  });

  it('prefills name and phone from contact snapshot and proceeds to slot fetch when required fields satisfied', async () => {
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
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: 'I want to book hair colour on 21 May around 9am',
      latestInboundText: 'I want to book hair colour on 21 May around 9am',
      metadata: {},
      contactSnapshot: { displayName: 'Alex', phone: '+15551234567' },
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(fetchFree).toHaveBeenCalled();
      const out = r.replyPlan.bubbles[0]!.text.toLowerCase();
      expect(out).toMatch(/9:00/);
      expect(out).not.toMatch(/which one would you like me to reserve/);
      expect(out).not.toMatch(/\n1\.\s/);
    }
  });

  it('batches optional name and phone in one ask before slots when service, date, and time are parsed', async () => {
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
      expect(fetchFree).not.toHaveBeenCalled();
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/name/);
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
        pendingFieldRequired: true,
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
        pendingFieldRequired: true,
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
        { startTime: '2030-05-10T10:00:00.000Z', endTime: '2030-05-10T10:30:00.000Z' },
        { startTime: '2030-05-10T10:30:00.000Z', endTime: '2030-05-10T11:00:00.000Z' },
        { startTime: '2030-05-10T11:00:00.000Z', endTime: '2030-05-10T11:30:00.000Z' },
        { startTime: '2030-05-10T11:30:00.000Z', endTime: '2030-05-10T12:00:00.000Z' },
      ],
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2030-05-10',
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
        preferredDate: '2030-05-10',
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
      { startTime: '2030-05-10T10:00:00.000Z', endTime: '2030-05-10T10:30:00.000Z' },
      { startTime: '2030-05-10T11:00:00.000Z', endTime: '2030-05-10T11:30:00.000Z' },
      { startTime: '2030-05-10T11:30:00.000Z', endTime: '2030-05-10T12:00:00.000Z' },
    ];
    const fetchFree = jest.fn(async () => ({
      slots: slotRows,
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2030-05-10',
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
        startIso: '2030-05-10T10:00:00.000Z',
        endIso: '2030-05-10T10:30:00.000Z',
        displayText: '6:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2030-05-10T11:00:00.000Z',
        endIso: '2030-05-10T11:30:00.000Z',
        displayText: '7:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 3,
        startIso: '2030-05-10T11:30:00.000Z',
        endIso: '2030-05-10T12:00:00.000Z',
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
        preferredDate: '2030-05-10',
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
      const bookArg = (bookSlot.mock.calls[0] ?? [])[0] as {
        title?: string;
        notes?: string;
      };
      expect(bookArg.title).toBe('Haircut');
      const n = bookArg.notes ?? '';
      expect(n).toContain('Service: Haircut');
      expect(n).toContain('Booking name: Alex');
      expect(n).toContain('Booking phone: +15551234567');
      expect(n).toContain('Source: AISBP booking assistant');
      expect(n).toContain('Contacted from:');
      expect(n).toContain('CRM contact name: -');
      expect(n).toContain('CRM contact phone: -');
      expect(n).not.toMatch(/conversation id/i);
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/confirmed/);
      const lastIntent = capturedActionIntentInserts.at(-1) as Record<string, unknown> | undefined;
      expect(lastIntent?.['status']).toBe('EXECUTED');
      expect(lastIntent?.['action_type']).toBe('UPDATE_CALENDAR');
    }
  });

  it('live book fills Contacted from via getContact when contactSnapshot is missing', async () => {
    const slotRows = [
      { startTime: '2030-05-10T10:00:00.000Z', endTime: '2030-05-10T10:30:00.000Z' },
      { startTime: '2030-05-10T11:00:00.000Z', endTime: '2030-05-10T11:30:00.000Z' },
      { startTime: '2030-05-10T11:30:00.000Z', endTime: '2030-05-10T12:00:00.000Z' },
    ];
    const fetchFree = jest.fn(async () => ({
      slots: slotRows,
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2030-05-10',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    }));
    const getContact = jest.fn(async () => ({
      success: true,
      contact: { firstName: 'GHL', lastName: 'User', phone: '+19997776666' },
    }));
    const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_lookup' }));
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({
        client: {
          bookSlot,
          getContact,
          getCalendar: jest.fn(async () => ({ summary: {} })),
          updateAppointmentNotes: jest.fn(async () => ({ success: true })),
          addContactNote: jest.fn(async () => ({ success: true })),
          findContactByPhone: jest.fn(async () => ({ success: true, contact: undefined })),
          createContact: jest.fn(),
          sendMessage: jest.fn(),
        },
        ghlLocationId: 'loc1',
      })),
    } as unknown as GhlService;
    const post = { runAfterLiveBookingConfirmed: jest.fn(async () => undefined) } as unknown as BookingPostConfirmService;
    const flow = new ConversationBookingFlowService(booking, ghl, post);
    const offeredSlots = [
      {
        option: 1,
        startIso: '2030-05-10T10:00:00.000Z',
        endIso: '2030-05-10T10:30:00.000Z',
        displayText: '6:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2030-05-10T11:00:00.000Z',
        endIso: '2030-05-10T11:30:00.000Z',
        displayText: '7:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 3,
        startIso: '2030-05-10T11:30:00.000Z',
        endIso: '2030-05-10T12:00:00.000Z',
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
        preferredDate: '2030-05-10',
        offeredSlots,
        slotDurationMinutes: 30,
      },
    };
    await flow.maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct_lookup',
      channel: 'SMS',
      combinedInboundText: '2',
      latestInboundText: '2',
      metadata: meta as Record<string, unknown>,
    });
    expect(getContact).toHaveBeenCalledWith('ct_lookup');
    const bookArg = (bookSlot.mock.calls[0] ?? [])[0] as { notes?: string };
    expect(bookArg.notes).toContain('CRM contact name: GHL User');
    expect(bookArg.notes).toContain('CRM contact phone: +19997776666');
    expect(post.runAfterLiveBookingConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        contactSnapshot: expect.objectContaining({
          displayName: 'GHL User',
          phone: '+19997776666',
        }),
      }),
    );
  });

  it('live book still confirms when getContact fails; Contacted from shows dashes', async () => {
    const slotRows = [
      { startTime: '2030-05-10T10:00:00.000Z', endTime: '2030-05-10T10:30:00.000Z' },
      { startTime: '2030-05-10T11:00:00.000Z', endTime: '2030-05-10T11:30:00.000Z' },
      { startTime: '2030-05-10T11:30:00.000Z', endTime: '2030-05-10T12:00:00.000Z' },
    ];
    const fetchFree = jest.fn(async () => ({
      slots: slotRows,
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2030-05-10',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    }));
    const getContact = jest.fn(async () => ({ success: false, contact: undefined }));
    const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_fail_lookup' }));
    const booking = {
      getBookingSettings: jest.fn(async () => baseSettings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({
        client: {
          bookSlot,
          getContact,
          getCalendar: jest.fn(async () => ({ summary: {} })),
          updateAppointmentNotes: jest.fn(async () => ({ success: true })),
          addContactNote: jest.fn(async () => ({ success: true })),
          findContactByPhone: jest.fn(async () => ({ success: true, contact: undefined })),
          createContact: jest.fn(),
          sendMessage: jest.fn(),
        },
        ghlLocationId: 'loc1',
      })),
    } as unknown as GhlService;
    const post = { runAfterLiveBookingConfirmed: jest.fn(async () => undefined) } as unknown as BookingPostConfirmService;
    const flow = new ConversationBookingFlowService(booking, ghl, post);
    const offeredSlots = [
      {
        option: 1,
        startIso: '2030-05-10T10:00:00.000Z',
        endIso: '2030-05-10T10:30:00.000Z',
        displayText: '6:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2030-05-10T11:00:00.000Z',
        endIso: '2030-05-10T11:30:00.000Z',
        displayText: '7:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 3,
        startIso: '2030-05-10T11:30:00.000Z',
        endIso: '2030-05-10T12:00:00.000Z',
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
        preferredDate: '2030-05-10',
        offeredSlots,
        slotDurationMinutes: 30,
      },
    };
    const r = await flow.maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct_bad',
      channel: 'SMS',
      combinedInboundText: '2',
      latestInboundText: '2',
      metadata: meta as Record<string, unknown>,
    });
    expect(getContact).toHaveBeenCalledWith('ct_bad');
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(bookSlot).toHaveBeenCalled();
      const bookArg = (bookSlot.mock.calls[0] ?? [])[0] as { notes?: string };
      expect(bookArg.notes).toContain('CRM contact name: -');
      expect(bookArg.notes).toContain('CRM contact phone: -');
      expect(bookArg.notes).toContain('Booking name: Alex');
      expect(bookArg.notes).toContain('Booking phone: +15551234567');
    }
    expect(post.runAfterLiveBookingConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        contactSnapshot: expect.objectContaining({
          displayName: undefined,
          phone: undefined,
        }),
      }),
    );
  });

  it('uses title "Appointment" when service is unknown at confirm time', async () => {
    const relaxedService = {
      ...baseSettings,
      coreFieldsJson: {
        ...baseSettings.coreFieldsJson,
        service: { enabled: true, required: false },
      },
    };
    const slotRows = [
      { startTime: '2030-05-10T10:00:00.000Z', endTime: '2030-05-10T10:30:00.000Z' },
      { startTime: '2030-05-10T11:00:00.000Z', endTime: '2030-05-10T11:30:00.000Z' },
    ];
    const fetchFree = jest.fn(async () => ({
      slots: slotRows,
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2030-05-10',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    }));
    const getContact = jest.fn(async () => ({
      success: true,
      contact: { firstName: 'X', lastName: 'Y', phone: '+18880001111' },
    }));
    const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_999' }));
    const booking = {
      getBookingSettings: jest.fn(async () => relaxedService),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({
        client: {
          bookSlot,
          getContact,
          getCalendar: jest.fn(async () => ({ summary: {} })),
          updateAppointmentNotes: jest.fn(async () => ({ success: true })),
          addContactNote: jest.fn(async () => ({ success: true })),
          findContactByPhone: jest.fn(async () => ({ success: true, contact: undefined })),
          createContact: jest.fn(),
          sendMessage: jest.fn(),
        },
        ghlLocationId: 'loc1',
      })),
    } as unknown as GhlService;
    const offeredSlots = [
      {
        option: 1,
        startIso: '2030-05-10T10:00:00.000Z',
        endIso: '2030-05-10T10:30:00.000Z',
        displayText: '6:00 AM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2030-05-10T11:00:00.000Z',
        endIso: '2030-05-10T11:30:00.000Z',
        displayText: '7:00 AM',
        calendarId: 'cal_1',
      },
    ];
    const meta = {
      aisbp_booking: {
        status: 'offered_slots',
        version: 1,
        calendarId: 'cal_1',
        customerName: 'Pat',
        phone: '+15550009999',
        service: '',
        preferredDate: '2030-05-10',
        offeredSlots,
        slotDurationMinutes: 30,
      },
    };
    const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
      tenantId: 't1',
      conversationId: 'c_no_svc',
      contactId: 'ct1',
      channel: 'SMS',
      combinedInboundText: '1',
      latestInboundText: '1',
      metadata: meta as Record<string, unknown>,
      contactSnapshot: { displayName: 'Snap Person', phone: '+15550001111' },
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(getContact).not.toHaveBeenCalled();
      const bookArg = (bookSlot.mock.calls[0] ?? [])[0] as { title?: string; notes?: string };
      expect(bookArg.title).toBe('Appointment');
      expect(bookArg.notes).toContain('CRM contact name: Snap Person');
      expect(bookArg.notes).toContain('CRM contact phone: +15550001111');
    }
  });

  describe('Ask without Required (optional) semantics', () => {
    it('offers slots after batch contact reply fills name and optional phone is left empty', async () => {
      const slots = [
        { startTime: '2026-05-21T09:00:00.000Z', endTime: '2026-05-21T09:30:00.000Z' },
        { startTime: '2026-05-21T09:30:00.000Z', endTime: '2026-05-21T10:00:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => ({
        slots,
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
        getBookingSettings: jest.fn(async () => allOptionalAskSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;

      let meta: Record<string, unknown> = {};
      let r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_opt_flow',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'I want to book hair colour on 21 May around 9am',
        latestInboundText: 'I want to book hair colour on 21 May around 9am',
        metadata: meta,
      });
      expect(r.handled).toBe(true);
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/Contact name/i);
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/Mobile number/i);
      meta = r.persistMetadata as Record<string, unknown>;

      r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_opt_flow',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'Lucy',
        latestInboundText: 'Lucy',
        metadata: meta,
      });
      expect(fetchFree).toHaveBeenCalled();
      const slotText = r.replyPlan.bubbles[0]!.text.toLowerCase();
      expect(slotText).toMatch(/9:00|available for|reserve/);
      expect(slotText).not.toMatch(/which one would you like me to reserve/);
    });

    it('after a non-answer to batch contact ask, does not re-ask optional name and proceeds toward slots', async () => {
      const fetchFree = jest.fn(async () => ({
        slots: [
          { startTime: '2026-05-21T09:00:00.000Z', endTime: '2026-05-21T09:30:00.000Z' },
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
        getBookingSettings: jest.fn(async () => allOptionalAskSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      let meta: Record<string, unknown> = {};
      let r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_opt_repeat',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'book hair colour on 21 May 9am',
        latestInboundText: 'book hair colour on 21 May 9am',
        metadata: meta,
      });
      meta = r.persistMetadata as Record<string, unknown>;
      r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_opt_repeat',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: '???',
        latestInboundText: '???',
        metadata: meta,
      });
      expect(fetchFree).toHaveBeenCalled();
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/contact name/);
    });

    it('refuses skip when phone is required', async () => {
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: jest.fn(),
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const meta = {
        aisbp_booking: {
          status: 'collecting_details',
          version: 1,
          calendarId: 'cal_1',
          customerName: 'Sam',
          service: 'Cut',
          preferredDate: '2030-05-10',
          preferredTime: '10:00',
          pendingFieldId: 'phone',
          pendingFieldRequired: true,
        },
      };
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_req_skip',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'skip',
        latestInboundText: 'skip',
        metadata: meta as Record<string, unknown>,
      });
      expect(r.handled).toBe(true);
      if (r.handled) {
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/i'll need.*booking/);
      }
    });

    it('does not prompt for service when service Ask is off', async () => {
      const s = {
        ...allOptionalAskSettings,
        coreFieldsJson: {
          ...allOptionalAskSettings.coreFieldsJson,
          service: { enabled: false, required: false },
        },
      };
      const booking = {
        getBookingSettings: jest.fn(async () => s),
        fetchFreeSlotsForAutomation: jest.fn(),
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_no_svc_ask',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'book colour on 21 May around 9am',
        latestInboundText: 'book colour on 21 May around 9am',
        metadata: {},
      });
      expect(r.handled).toBe(true);
      if (r.handled) {
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/what service would you like/i);
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/name/);
      }
    });
  });

  describe('first_visit pending field and short UNKNOWN replies', () => {
    const optionalWithFirstVisit = {
      ...allOptionalAskSettings,
      coreFieldsJson: {
        ...allOptionalAskSettings.coreFieldsJson,
        first_visit: { enabled: true, required: false },
      },
    };

    const slotRow = { startTime: '2026-05-22T09:00:00.000Z', endTime: '2026-05-22T09:30:00.000Z' };

    function fetchFreeFactory() {
      return jest.fn(async () => ({
        slots: [slotRow],
        calendarId: 'cal_1',
        error: undefined as string | undefined,
        retriedWithUserId: null,
        crmTimezoneUsed: 'UTC',
        selectedDate: '2026-05-22',
        selectedTime: '',
        startMs: 0,
        endMs: 1,
        ghlLocationId: 'loc',
      }));
    }

    function metaPendingFirstVisit(): Record<string, unknown> {
      return {
        aisbp_booking: {
          status: 'collecting_details',
          version: 1,
          calendarId: 'cal_1',
          service: 'Hair colour',
          customerName: 'Lucy',
          phone: '026234216',
          preferredDate: '2026-05-22',
          preferredTime: '09:00',
          pendingFieldId: 'first_visit',
          pendingFieldRequired: false,
          optionalAskedFieldIds: ['first_visit'],
          lastAskedFieldId: 'first_visit',
          lastAskedAt: new Date().toISOString(),
        },
      };
    }

    it('A: pending first_visit "yes" => firstVisit yes, slots offered', async () => {
      const fetchFree = fetchFreeFactory();
      const booking = {
        getBookingSettings: jest.fn(async () => optionalWithFirstVisit),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_fv_a',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'yes',
        latestInboundText: 'yes',
        metadata: metaPendingFirstVisit(),
      });
      expect(r.handled).toBe(true);
      expect(fetchFree).toHaveBeenCalled();
      if (r.handled) {
        const b = (r.persistMetadata as Record<string, unknown>).aisbp_booking as Record<string, unknown>;
        expect(b.firstVisit).toBe('yes');
        expect(b.pendingFieldId).toBeUndefined();
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/9:00|available for|reserve/);
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/\n1\.\s/);
      }
    });

    it('B: pending first_visit "yes?" => firstVisit yes, slots offered', async () => {
      const fetchFree = fetchFreeFactory();
      const booking = {
        getBookingSettings: jest.fn(async () => optionalWithFirstVisit),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_fv_b',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'yes?',
        latestInboundText: 'yes?',
        metadata: metaPendingFirstVisit(),
      });
      expect(r.handled).toBe(true);
      expect(fetchFree).toHaveBeenCalled();
      if (r.handled) {
        const b = (r.persistMetadata as Record<string, unknown>).aisbp_booking as Record<string, unknown>;
        expect(b.firstVisit).toBe('yes');
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/9:00|available for|reserve/);
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/\n1\.\s/);
      }
    });

    it('C: pending first_visit "no" => firstVisit no, slots offered', async () => {
      const fetchFree = fetchFreeFactory();
      const booking = {
        getBookingSettings: jest.fn(async () => optionalWithFirstVisit),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_fv_c',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'no',
        latestInboundText: 'no',
        metadata: metaPendingFirstVisit(),
      });
      expect(r.handled).toBe(true);
      expect(fetchFree).toHaveBeenCalled();
      if (r.handled) {
        const b = (r.persistMetadata as Record<string, unknown>).aisbp_booking as Record<string, unknown>;
        expect(b.firstVisit).toBe('no');
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/9:00|available for|reserve/);
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/\n1\.\s/);
      }
    });

    it('D: pending first_visit optional skip => skippedFieldIds includes first_visit, slots offered', async () => {
      const fetchFree = fetchFreeFactory();
      const booking = {
        getBookingSettings: jest.fn(async () => optionalWithFirstVisit),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_fv_d',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'skip',
        latestInboundText: 'skip',
        metadata: metaPendingFirstVisit(),
      });
      expect(r.handled).toBe(true);
      expect(fetchFree).toHaveBeenCalled();
      if (r.handled) {
        const b = (r.persistMetadata as Record<string, unknown>).aisbp_booking as Record<string, unknown>;
        expect(b.skippedFieldIds).toEqual(expect.arrayContaining(['first_visit']));
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/9:00|available for|reserve/);
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/\n1\.\s/);
      }
    });

    it('E: optional first_visit asked once, unclear answer => proceeds to slots without repeating first_visit', async () => {
      const fetchFree = fetchFreeFactory();
      const booking = {
        getBookingSettings: jest.fn(async () => optionalWithFirstVisit),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_fv_e',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: '~~~confused~~~',
        latestInboundText: '~~~confused~~~',
        metadata: metaPendingFirstVisit(),
      });
      expect(r.handled).toBe(true);
      expect(fetchFree).toHaveBeenCalled();
      if (r.handled) {
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/9:00|available for|reserve/);
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/\n1\.\s/);
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/first visit/);
      }
    });

    it('F: active booking + pendingFieldId without valid status + "yes" still parses (no booking keywords)', async () => {
      const fetchFree = fetchFreeFactory();
      const booking = {
        getBookingSettings: jest.fn(async () => optionalWithFirstVisit),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const raw = {
        version: 1,
        calendarId: 'cal_1',
        service: 'Hair colour',
        customerName: 'Lucy',
        phone: '026234216',
        preferredDate: '2026-05-22',
        preferredTime: '09:00',
        pendingFieldId: 'first_visit',
        pendingFieldRequired: false,
        optionalAskedFieldIds: ['first_visit'],
        lastAskedFieldId: 'first_visit',
        lastAskedAt: new Date().toISOString(),
      } as Record<string, unknown>;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_fv_f',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'yes',
        latestInboundText: 'yes',
        metadata: { aisbp_booking: raw },
      });
      expect(r.handled).toBe(true);
      expect(fetchFree).toHaveBeenCalled();
      if (r.handled) {
        const b = (r.persistMetadata as Record<string, unknown>).aisbp_booking as Record<string, unknown>;
        expect(b.firstVisit).toBe('yes');
        expect(b.status).toBe('offered_slots');
      }
    });
  });

  describe('offered_slots selection and time revision', () => {
    const offeredMorningUtc = [
      {
        option: 1,
        startIso: '2030-05-10T12:00:00.000Z',
        endIso: '2030-05-10T12:30:00.000Z',
        displayText: '12:00 PM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2030-05-10T12:30:00.000Z',
        endIso: '2030-05-10T13:00:00.000Z',
        displayText: '12:30 PM',
        calendarId: 'cal_1',
      },
      {
        option: 3,
        startIso: '2030-05-10T13:00:00.000Z',
        endIso: '2030-05-10T13:30:00.000Z',
        displayText: '1:00 PM',
        calendarId: 'cal_1',
      },
    ];

    const slotFetchResponse = (slots: { startTime: string; endTime: string }[]) => ({
      slots,
      calendarId: 'cal_1',
      error: undefined as string | undefined,
      retriedWithUserId: null,
      crmTimezoneUsed: 'UTC',
      selectedDate: '2030-05-10',
      selectedTime: '',
      startMs: 0,
      endMs: 1,
      ghlLocationId: 'loc',
    });

    function baseOfferedMeta(offered: typeof offeredMorningUtc): Record<string, unknown> {
      return {
        aisbp_booking: {
          status: 'offered_slots',
          version: 1,
          calendarId: 'cal_1',
          customerName: 'Alex',
          phone: '+15551234567',
          service: 'Haircut',
          preferredDate: '2030-05-10',
          offeredSlots: offered,
          offeredSlotsCrmTimeZone: 'UTC',
          slotDurationMinutes: 30,
        },
      };
    }

    it('D: offered_slots "3" books the third listed slot', async () => {
      const slotRows = [
        { startTime: '2030-05-10T10:00:00.000Z', endTime: '2030-05-10T10:30:00.000Z' },
        { startTime: '2030-05-10T11:00:00.000Z', endTime: '2030-05-10T11:30:00.000Z' },
        { startTime: '2030-05-10T11:30:00.000Z', endTime: '2030-05-10T12:00:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => slotFetchResponse(slotRows));
      const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_d3' }));
      const offered = [
        {
          option: 1,
          startIso: '2030-05-10T10:00:00.000Z',
          endIso: '2030-05-10T10:30:00.000Z',
          displayText: '6:00 AM',
          calendarId: 'cal_1',
        },
        {
          option: 2,
          startIso: '2030-05-10T11:00:00.000Z',
          endIso: '2030-05-10T11:30:00.000Z',
          displayText: '7:00 AM',
          calendarId: 'cal_1',
        },
        {
          option: 3,
          startIso: '2030-05-10T11:30:00.000Z',
          endIso: '2030-05-10T12:00:00.000Z',
          displayText: '7:30 AM',
          calendarId: 'cal_1',
        },
      ];
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {
        createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({
          client: {
            bookSlot,
            getContact: jest.fn(async () => ({ success: true, contact: {} })),
            getCalendar: jest.fn(async () => ({ summary: {} })),
            updateAppointmentNotes: jest.fn(async () => ({ success: true })),
            addContactNote: jest.fn(async () => ({ success: true })),
            findContactByPhone: jest.fn(async () => ({ success: true, contact: undefined })),
            createContact: jest.fn(),
            sendMessage: jest.fn(),
          },
          ghlLocationId: 'loc1',
        })),
      } as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_slot_d',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: '3',
        latestInboundText: '3',
        metadata: baseOfferedMeta(offered),
      });
      expect(r.handled).toBe(true);
      expect(bookSlot).toHaveBeenCalled();
      const arg = (bookSlot.mock.calls[0] ?? [])[0] as { startTime?: string };
      expect(arg.startTime).toBe('2030-05-10T11:30:00.000Z');
    });

    it('A: offered_slots "2pm can?" does not send rigid numeric-only pick copy', async () => {
      const afternoonSlots = [
        { startTime: '2030-05-10T14:00:00.000Z', endTime: '2030-05-10T14:30:00.000Z' },
        { startTime: '2030-05-10T14:30:00.000Z', endTime: '2030-05-10T15:00:00.000Z' },
        { startTime: '2030-05-10T15:00:00.000Z', endTime: '2030-05-10T15:30:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => slotFetchResponse(afternoonSlots));
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const r = await svc(booking, {} as GhlService).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_slot_a',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: '2pm can?',
        latestInboundText: '2pm can?',
        metadata: baseOfferedMeta(offeredMorningUtc),
      });
      expect(r.handled).toBe(true);
      if (r.handled) {
        expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/Please reply with 1, 2, or 3/i);
        expect(r.replyPlan.bubbles[0]!.text).toMatch(/2:00\s*PM/i);
      }
    });

    it('B: offered_slots "I want 2pm" refetches with preferredTime 14:00', async () => {
      const afternoonSlots = [
        { startTime: '2030-05-10T14:00:00.000Z', endTime: '2030-05-10T14:30:00.000Z' },
        { startTime: '2030-05-10T14:30:00.000Z', endTime: '2030-05-10T15:00:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => slotFetchResponse(afternoonSlots));
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      await svc(booking, {} as GhlService).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_slot_b',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'I want 2pm',
        latestInboundText: 'I want 2pm',
        metadata: baseOfferedMeta(offeredMorningUtc),
      });
      const last = fetchFree.mock.calls.at(-1)?.[1] as { selectedTime?: string } | undefined;
      expect(last?.selectedTime).toBe('14:00');
    });

    it('C: offered_slots "afternoon" sets preferredTimeWindow and refetches', async () => {
      const pool = [
        { startTime: '2030-05-10T14:00:00.000Z', endTime: '2030-05-10T14:30:00.000Z' },
        { startTime: '2030-05-10T15:00:00.000Z', endTime: '2030-05-10T15:30:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => slotFetchResponse(pool));
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const r = await svc(booking, {} as GhlService).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_slot_c',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'afternoon',
        latestInboundText: 'afternoon',
        metadata: baseOfferedMeta(offeredMorningUtc),
      });
      expect(r.handled).toBe(true);
      if (r.handled) {
        const b = (r.persistMetadata as Record<string, unknown>).aisbp_booking as Record<string, unknown>;
        expect(b.preferredTimeWindow).toBe('afternoon');
        expect(b.preferredTime).toBeUndefined();
      }
    });

    it('F: when 2pm exists in CRM, it is listed first after revision', async () => {
      const slots = [
        { startTime: '2030-05-10T14:00:00.000Z', endTime: '2030-05-10T14:30:00.000Z' },
        { startTime: '2030-05-10T15:30:00.000Z', endTime: '2030-05-10T16:00:00.000Z' },
        { startTime: '2030-05-10T16:00:00.000Z', endTime: '2030-05-10T16:30:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => slotFetchResponse(slots));
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const r = await svc(booking, {} as GhlService).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_slot_f',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: '2pm',
        latestInboundText: '2pm',
        metadata: baseOfferedMeta(offeredMorningUtc),
      });
      expect(r.handled).toBe(true);
      if (r.handled) {
        const text = r.replyPlan.bubbles[0]!.text;
        expect(text).toMatch(/2:00\s*PM is available/i);
      }
    });

    it('G: when 2pm missing, copy mentions unavailable and closest slots', async () => {
      const slots = [
        { startTime: '2030-05-10T13:30:00.000Z', endTime: '2030-05-10T14:00:00.000Z' },
        { startTime: '2030-05-10T14:30:00.000Z', endTime: '2030-05-10T15:00:00.000Z' },
        { startTime: '2030-05-10T15:00:00.000Z', endTime: '2030-05-10T15:30:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => slotFetchResponse(slots));
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const r = await svc(booking, {} as GhlService).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_slot_g',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: '2pm',
        latestInboundText: '2pm',
        metadata: baseOfferedMeta(offeredMorningUtc),
      });
      expect(r.handled).toBe(true);
      if (r.handled) {
        const t = r.replyPlan.bubbles[0]!.text;
        expect(t.toLowerCase()).toMatch(/isn't available|not available/i);
        expect(t).toMatch(/1\./);
      }
    });

    it('H: gibberish still gets softer selection help copy', async () => {
      const fetchFree = jest.fn(async () => slotFetchResponse([]));
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const r = await svc(booking, {} as GhlService).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_slot_h',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'asdfgh qwerty',
        latestInboundText: 'asdfgh qwerty',
        metadata: baseOfferedMeta(offeredMorningUtc),
      });
      expect(r.handled).toBe(true);
      if (r.handled) {
        expect(r.replyPlan.bubbles[0]!.text).toMatch(/listed times/i);
        expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/Please reply with 1, 2, or 3/i);
      }
    });

    it('E: exact displayed time from offer books that slot', async () => {
      const slotRows = [
        { startTime: '2030-05-10T12:00:00.000Z', endTime: '2030-05-10T12:30:00.000Z' },
        { startTime: '2030-05-10T12:30:00.000Z', endTime: '2030-05-10T13:00:00.000Z' },
        { startTime: '2030-05-10T13:00:00.000Z', endTime: '2030-05-10T13:30:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => slotFetchResponse(slotRows));
      const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_e' }));
      const booking = {
        getBookingSettings: jest.fn(async () => baseSettings),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {
        createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({
          client: {
            bookSlot,
            getContact: jest.fn(async () => ({ success: true, contact: {} })),
            getCalendar: jest.fn(async () => ({ summary: {} })),
            updateAppointmentNotes: jest.fn(async () => ({ success: true })),
            addContactNote: jest.fn(async () => ({ success: true })),
            findContactByPhone: jest.fn(async () => ({ success: true, contact: undefined })),
            createContact: jest.fn(),
            sendMessage: jest.fn(),
          },
          ghlLocationId: 'loc1',
        })),
      } as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_slot_e',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: '12:30 PM',
        latestInboundText: '12:30 PM',
        metadata: baseOfferedMeta(offeredMorningUtc),
      });
      expect(r.handled).toBe(true);
      expect(bookSlot).toHaveBeenCalled();
      if (r.handled) {
        expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).toMatch(/confirmed/);
      }
    });
  });

  describe('service intake validation', () => {
    const settingsWithServiceMenu = { ...baseSettings, serviceMenuOptions: ['Haircut', 'Colour', 'Scalp Treatment'] };

    it('A: "I want to book" does not persist generic text as service', async () => {
      const fetchFree = jest.fn();
      const booking = {
        getBookingSettings: jest.fn(async () => settingsWithServiceMenu),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_svc_a',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'I want to book',
        latestInboundText: 'I want to book',
        metadata: {} as Record<string, unknown>,
      });
      expect(r.handled).toBe(true);
      expect(fetchFree).not.toHaveBeenCalled();
      if (r.handled) {
        const b = (r.persistMetadata as Record<string, unknown>).aisbp_booking as Record<string, unknown>;
        expect(String(b.service ?? '').trim()).toBe('');
        expect(r.replyPlan.bubbles[0]!.text).toMatch(/A\)\s*Haircut/i);
        expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/What date would you prefer/i);
      }
    });

    it('B: required service prompt comes before date when only generic booking intent is sent', async () => {
      const fetchFree = jest.fn();
      const booking = {
        getBookingSettings: jest.fn(async () => settingsWithServiceMenu),
        fetchFreeSlotsForAutomation: fetchFree,
      } as unknown as BookingSettingsService;
      const ghl = {} as unknown as GhlService;
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_svc_b',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: 'I want to book',
        latestInboundText: 'I want to book',
        metadata: {} as Record<string, unknown>,
      });
      expect(r.handled).toBe(true);
      if (r.handled) {
        expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/What date would you prefer/i);
      }
    });

    it('E: offered slot pick does not create appointment when stored service is generic', async () => {
      const slotRows = [
        { startTime: '2030-05-10T10:00:00.000Z', endTime: '2030-05-10T10:30:00.000Z' },
        { startTime: '2030-05-10T11:00:00.000Z', endTime: '2030-05-10T11:30:00.000Z' },
        { startTime: '2030-05-10T11:30:00.000Z', endTime: '2030-05-10T12:00:00.000Z' },
      ];
      const fetchFree = jest.fn(async () => ({
        slots: slotRows,
        calendarId: 'cal_1',
        error: undefined as string | undefined,
        retriedWithUserId: null,
        crmTimezoneUsed: 'UTC',
        selectedDate: '2030-05-10',
        selectedTime: '',
        startMs: 0,
        endMs: 1,
        ghlLocationId: 'loc',
      }));
      const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_should_not' }));
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
          startIso: '2030-05-10T10:00:00.000Z',
          endIso: '2030-05-10T10:30:00.000Z',
          displayText: '6:00 AM',
          calendarId: 'cal_1',
        },
        {
          option: 2,
          startIso: '2030-05-10T11:00:00.000Z',
          endIso: '2030-05-10T11:30:00.000Z',
          displayText: '7:00 AM',
          calendarId: 'cal_1',
        },
        {
          option: 3,
          startIso: '2030-05-10T11:30:00.000Z',
          endIso: '2030-05-10T12:00:00.000Z',
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
          service: 'I want to book',
          preferredDate: '2030-05-10',
          offeredSlots,
          offeredSlotsCrmTimeZone: 'UTC',
          slotDurationMinutes: 30,
        },
      };
      const r = await svc(booking, ghl).maybeHandleConversationBookingTurn({
        tenantId: 't1',
        conversationId: 'c_svc_e',
        contactId: 'ct1',
        channel: 'SMS',
        combinedInboundText: '1',
        latestInboundText: '1',
        metadata: meta as Record<string, unknown>,
      });
      expect(r.handled).toBe(true);
      expect(bookSlot).not.toHaveBeenCalled();
      if (r.handled) {
        expect(r.replyPlan.rationale).toBe('booking_required_before_confirm');
        const b = (r.persistMetadata as Record<string, unknown>).aisbp_booking as Record<string, unknown>;
        expect(b.status).toBe('collecting_details');
        expect(b.pendingFieldId).toBe('service');
      }
    });
  });
});
