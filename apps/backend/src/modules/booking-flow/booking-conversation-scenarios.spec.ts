import { jest, describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { ConversationBookingFlowService } from './conversation-booking-flow.service';
import { BookingConversationHarness } from './booking-conversation.harness';
import type { BookingPostConfirmService } from './booking-post-confirm.service';
import type { BookingSettingsService } from '../booking-settings/booking-settings.service';
import type { GhlService } from '../ghl/ghl.service';
import type { TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
import type { BookingNluInterpreterService } from './booking-nlu-interpreter.service';
import type { BookingNluInterpretInput, BookingNluOutput } from './booking-nlu.schema';
import { buildBookingSummaryText } from './booking-summary';
import type { AisbpBookingStateV1, AisbpOfferedSlot } from './conversation-booking-state';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: (table: string) => {
      if (table === 'action_intents') {
        const intentQueryResult = { data: [], error: null };
        const intentSelectChain = (): Record<string, unknown> => ({
          contains: () => ({
            order: () => ({
              limit: () => intentQueryResult,
            }),
          }),
          eq: () => intentSelectChain(),
        });
        return {
          insert: () => ({ error: null }),
          select: () => intentSelectChain(),
        };
      }
      if (table === 'conversations') {
        const conversationLockResult = {
          data: { metadata: {}, updated_at: '2026-01-01T00:00:00.000Z' },
          error: null,
        };
        const updateOk = {
          select: () => Promise.resolve({ data: [{ id: 'mock-conv' }], error: null }),
        };
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(conversationLockResult),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => updateOk,
              select: () => Promise.resolve({ data: [{ id: 'mock-conv' }], error: null }),
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

const STYLIST_FIELD_ID = 'cf_stylist_pref';

const scenarioTenantSettings = (): TenantBookingSettingsDto => ({
  enabled: true,
  bookingMode: 'CHECK_AVAILABILITY',
  defaultGhlCalendarId: 'cal_1',
  defaultGhlCalendarName: 'LUMIÈRE HAIR ATELIER',
  coreFieldsJson: {
    name: { enabled: true, required: true },
    phone: { enabled: true, required: true },
    email: { enabled: false, required: false },
    service: { enabled: true, required: true },
    preferred_date: { enabled: true, required: true },
    preferred_time: { enabled: true, required: true },
    first_visit: { enabled: true, required: false },
  },
  customFieldsJson: [
    {
      id: STYLIST_FIELD_ID,
      label: 'Any Preference for Male or Female stylist?',
      fieldType: 'single_select',
      options: ['Male', 'Female', 'Anything'],
      required: true,
      displayOrder: 0,
    } satisfies CustomBookingFieldDto,
  ],
  maxBookingsPerSlot: 1,
  serviceMenuOptions: ['Haircut', 'Colour', 'Scalp Treatment'],
  internalBookingAlertEnabled: false,
  internalBookingAlertNumber: null,
  internalBookingAlertChannel: 'GHL_MESSAGE',
  internalBookingAlertTemplate: null,
});

function may29SlotFetch() {
  const slots = [
    { startTime: '2026-05-29T04:00:00.000Z', endTime: '2026-05-29T04:30:00.000Z' },
    { startTime: '2026-05-29T04:30:00.000Z', endTime: '2026-05-29T05:00:00.000Z' },
    { startTime: '2026-05-29T07:00:00.000Z', endTime: '2026-05-29T07:30:00.000Z' },
  ];
  return {
    slots,
    calendarId: 'cal_1',
    error: undefined as string | undefined,
    retriedWithUserId: null,
    crmTimezoneUsed: 'Asia/Kuala_Lumpur',
    selectedDate: '2026-05-29',
    selectedTime: '',
    startMs: 0,
    endMs: 1,
    ghlLocationId: 'loc',
  };
}

function flowSvc(
  booking: BookingSettingsService,
  ghl: GhlService,
  post?: BookingPostConfirmService,
  nlu?: Pick<BookingNluInterpreterService, 'interpret'>,
) {
  const p = post ?? ({ runAfterLiveBookingConfirmed: jest.fn(async () => undefined) } as unknown as BookingPostConfirmService);
  const nluSvc = nlu ? ({ interpret: nlu.interpret } as unknown as BookingNluInterpreterService) : undefined;
  const enriched = {
    resolveTenantCrmTimezone: jest.fn(async () => null),
    loadCalendarBookingRules: jest.fn(async () => ({ slotDurationMinutes: 30, appointmentsPerSlot: 1 })),
    ...booking,
  } as unknown as BookingSettingsService;
  return new ConversationBookingFlowService(enriched, ghl, p, nluSvc);
}

describe('Booking conversation scenarios (harness)', () => {
  beforeAll(() => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('Scenario 1: full happy path — service before date, slots after intake, summary uses Haircut + Male', async () => {
    const fetchFree = jest.fn(async (_tid: string, args: { selectedDate?: string }) => {
      if (args.selectedDate === '2026-05-29') return may29SlotFetch();
      return { ...may29SlotFetch(), slots: [], error: 'no_match' as string | undefined };
    });
    const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_scen_1' }));
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
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

    const flow = flowSvc(booking, ghl);
    const h = new BookingConversationHarness(flow, {
      tenantId: 't1',
      conversationId: 'c_scen_1',
      contactId: 'ct_scen_1',
      channel: 'SMS',
      tenantTimeZone: 'Asia/Kuala_Lumpur',
    });

    let r = await h.say('I want to book');
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(fetchFree).not.toHaveBeenCalled();
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/service|haircut|colour|scalp/i);
      expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/What date would you prefer/i);
      expect(String(h.bookingState()?.['service'] ?? '').trim()).toBe('');
    }

    r = await h.say('haircut');
    expect(r.handled).toBe(true);
    expect(h.bookingState()?.['service']).toBe('Haircut');

    r = await h.say('29th may');
    expect(r.handled).toBe(true);
    expect(h.bookingState()?.['preferredDate']).toBe('2026-05-29');

    r = await h.say('11am');
    expect(r.handled).toBe(true);
    expect(h.bookingState()?.['preferredTime']).toBe('11:00');
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/check availability|provide/i);
    }

    r = await h.say('weewang, 141 235 5123, male, yes first visit');
    expect(r.handled).toBe(true);
    expect(h.bookingState()?.['customerName']).toMatch(/weewang/i);
    expect(String(h.bookingState()?.['phone'] ?? '').replace(/\s+/g, '')).toMatch(/141/);
    expect(h.bookingState()?.['firstVisit']).toBeTruthy();
    expect(JSON.stringify(h.bookingState()?.['customAnswers'] ?? {})).toContain('Male');

    expect(fetchFree).toHaveBeenCalled();
    expect(h.bookingState()?.['status']).toBe('offered_slots');
    const offered = h.bookingState()?.['offeredSlots'] as AisbpOfferedSlot[] | undefined;
    expect(offered?.length).toBeGreaterThanOrEqual(3);
    const pickedOffered = offered![0]!;
    expect(pickedOffered.option).toBe(1);

    r = await h.say('1');
    expect(r.handled).toBe(true);
    expect(bookSlot).toHaveBeenCalledTimes(1);
    const bookArg = (bookSlot.mock.calls[0] ?? [])[0] as { notes?: string; startTime?: string };
    expect(bookArg.startTime).toBe(pickedOffered.startIso);
    const notes = bookArg.notes ?? '';
    expect(notes).toContain('Service: Haircut');
    expect(notes).toMatch(/Booking name:\s*Weewang/i);
    expect(notes).toMatch(/141\s*235\s*5123|1412355123/);
    expect(notes).toMatch(/First visit:\s*Yes/i);
    expect(notes).toMatch(/Any Preference for Male or Female stylist\?:\s*Male/i);
    expect(notes).not.toMatch(/I want to book/i);
    expect(notes).not.toMatch(/Male,Female,Anything/);
  });

  it('Scenario 2: generic booking intent lines never persist as service', async () => {
    const fetchFree = jest.fn();
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const h = new BookingConversationHarness(flowSvc(booking, {} as GhlService), {
      tenantId: 't1',
      conversationId: 'c_scen_2',
      contactId: 'ct1',
      channel: 'SMS',
      tenantTimeZone: 'Asia/Kuala_Lumpur',
    });

    for (const line of ['I want to book', 'book appointment', 'appointment please']) {
      const r = await h.say(line);
      expect(r.handled).toBe(true);
    }
    expect(String(h.bookingState()?.['service'] ?? '').trim()).toBe('');
    expect(fetchFree).not.toHaveBeenCalled();
  });

  it('Scenario 3: service embedded in intent resolves to Haircut', async () => {
    const fetchFree = jest.fn();
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const h = new BookingConversationHarness(flowSvc(booking, {} as GhlService), {
      tenantId: 't1',
      conversationId: 'c_scen_3',
      contactId: 'ct1',
      channel: 'SMS',
    });
    const r = await h.say('I want to book haircut');
    expect(r.handled).toBe(true);
    expect(h.bookingState()?.['service']).toBe('Haircut');
  });

  it('Scenario 4: single_select stores canonical Male; staff summary never shows option blob', async () => {
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
      fetchFreeSlotsForAutomation: jest.fn(),
    } as unknown as BookingSettingsService;
    const h = new BookingConversationHarness(flowSvc(booking, {} as GhlService), {
      tenantId: 't1',
      conversationId: 'c_scen_4',
      contactId: 'ct1',
      channel: 'SMS',
    });
    h.reset({
      aisbp_booking: {
        status: 'collecting_details',
        version: 1,
        calendarId: 'cal_1',
        service: 'Haircut',
        customerName: 'Pat',
        phone: '+15550001111',
        preferredDate: '2026-05-29',
        preferredTime: '15:00',
        pendingFieldId: `custom:${STYLIST_FIELD_ID}`,
        pendingFieldRequired: true,
      },
    });
    const r = await h.say('male');
    expect(r.handled).toBe(true);
    const ca = h.bookingState()?.['customAnswers'] as Record<string, string> | undefined;
    expect(ca?.[STYLIST_FIELD_ID]).toBe('Male');

    const settings = scenarioTenantSettings();
    const bookingState = h.bookingState() as unknown as AisbpBookingStateV1;
    const summary = buildBookingSummaryText({
      appointmentId: 'ap_x',
      bookingStatusLabel: 'Confirmed',
      booking: bookingState,
      coreFieldsJson: settings.coreFieldsJson,
      customFieldsJson: settings.customFieldsJson,
      serviceMenuOptions: settings.serviceMenuOptions,
      conversationContactSnapshot: {},
      calendarName: settings.defaultGhlCalendarName ?? undefined,
      selectedSlot: {
        option: 1,
        startIso: '2026-05-29T07:00:00.000Z',
        endIso: '2026-05-29T07:30:00.000Z',
        displayText: '3:00 PM',
        calendarId: 'cal_1',
      },
      crmTimeZone: 'Asia/Kuala_Lumpur',
    });
    expect(summary).toMatch(/Any Preference for Male or Female stylist\?:\s*Male/i);
    expect(summary).not.toMatch(/Male,Female,Anything/);
  });

  it('Scenario 5: time revision from offered slots refetches and avoids rigid numeric-only pick copy', async () => {
    const offeredMorningUtc: AisbpOfferedSlot[] = [
      {
        option: 1,
        startIso: '2026-05-10T12:00:00.000Z',
        endIso: '2026-05-10T12:30:00.000Z',
        displayText: '12:00 PM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2026-05-10T12:30:00.000Z',
        endIso: '2026-05-10T13:00:00.000Z',
        displayText: '12:30 PM',
        calendarId: 'cal_1',
      },
      {
        option: 3,
        startIso: '2026-05-10T13:00:00.000Z',
        endIso: '2026-05-10T13:30:00.000Z',
        displayText: '1:00 PM',
        calendarId: 'cal_1',
      },
    ];
    const afternoonSlots = [
      { startTime: '2026-05-10T14:00:00.000Z', endTime: '2026-05-10T14:30:00.000Z' },
      { startTime: '2026-05-10T14:30:00.000Z', endTime: '2026-05-10T15:00:00.000Z' },
      { startTime: '2026-05-10T15:00:00.000Z', endTime: '2026-05-10T15:30:00.000Z' },
    ];
    const fetchFree = jest.fn(async () => ({
      slots: afternoonSlots,
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
    const settings = scenarioTenantSettings();
    const booking = {
      getBookingSettings: jest.fn(async () => settings),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;

    const meta = {
      aisbp_booking: {
        status: 'offered_slots',
        version: 1,
        calendarId: 'cal_1',
        customerName: 'Alex',
        phone: '+15551234567',
        service: 'Haircut',
        preferredDate: '2026-05-10',
        offeredSlots: offeredMorningUtc,
        slotDurationMinutes: 30,
      },
    };

    const h = new BookingConversationHarness(flowSvc(booking, {} as GhlService), {
      tenantId: 't1',
      conversationId: 'c_scen_5',
      contactId: 'ct1',
      channel: 'SMS',
    });
    h.reset(meta);
    const r = await h.say('2pm can?');
    expect(r.handled).toBe(true);
    expect(fetchFree.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastArg = fetchFree.mock.calls.at(-1)?.[1] as { selectedTime?: string } | undefined;
    expect(lastArg?.selectedTime).toBe('14:00');
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/Please reply with 1, 2, or 3/i);
      expect(r.replyPlan.bubbles[0]!.text).toMatch(/2:00\s*PM/i);
    }
  });

  it('Scenario 6: date-only reply while service is still missing does not fetch slots or create', async () => {
    const fetchFree = jest.fn(async () => may29SlotFetch());
    const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_bad' }));
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
      fetchFreeSlotsForAutomation: fetchFree,
    } as unknown as BookingSettingsService;
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({
        client: { bookSlot },
        ghlLocationId: 'loc1',
      })),
    } as unknown as GhlService;

    const h = new BookingConversationHarness(flowSvc(booking, ghl), {
      tenantId: 't1',
      conversationId: 'c_scen_6',
      contactId: 'ct1',
      channel: 'SMS',
    });

    let r = await h.say('I want to book');
    expect(r.handled).toBe(true);
    expect(fetchFree).not.toHaveBeenCalled();

    r = await h.say('29 may');
    expect(r.handled).toBe(true);
    expect(fetchFree).not.toHaveBeenCalled();
    expect(String(h.bookingState()?.['service'] ?? '').trim()).toBe('');
    expect(bookSlot).not.toHaveBeenCalled();
  });

  it('Scenario 7: NLU — haircut can?, 29th may 330pm fills date and 15:30 without re-asking time', async () => {
    const interpret = jest.fn(async (input: BookingNluInterpretInput): Promise<BookingNluOutput | null> => {
        const t = input.latestInboundText.toLowerCase();
        if (t.includes('haircut') && t.includes('can')) {
          return {
            intent: 'provide_field',
            confidence: 0.91,
            fields: {
              service: 'Haircut',
              preferredDate: null,
              preferredTime: null,
              preferredTimeWindow: null,
              name: null,
              phone: null,
              email: null,
              firstVisit: null,
              customAnswers: {},
            },
            slotSelection: { type: 'none', index: null, time: null },
            userFrustrated: false,
            notes: null,
          };
        }
        if (t.includes('29') && t.includes('may') && t.includes('330')) {
          return {
            intent: 'provide_field',
            confidence: 0.94,
            fields: {
              service: null,
              preferredDate: '2026-05-29',
              preferredTime: '15:30',
              preferredTimeWindow: null,
              name: null,
              phone: null,
              email: null,
              firstVisit: null,
              customAnswers: {},
            },
            slotSelection: { type: 'none', index: null, time: null },
            userFrustrated: false,
            notes: null,
          };
        }
        return null;
    });
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
      fetchFreeSlotsForAutomation: jest.fn(async () => may29SlotFetch()),
    } as unknown as BookingSettingsService;

    const h = new BookingConversationHarness(flowSvc(booking, {} as GhlService, undefined, { interpret }), {
      tenantId: 't1',
      conversationId: 'c_scen_7',
      contactId: 'ct1',
      channel: 'SMS',
      tenantTimeZone: 'Asia/Kuala_Lumpur',
    });

    let r = await h.say('I want to book');
    expect(r.handled).toBe(true);

    r = await h.say('haircut can?');
    expect(r.handled).toBe(true);
    expect(h.bookingState()?.['service']).toBe('Haircut');

    r = await h.say('29th may 330pm');
    expect(r.handled).toBe(true);
    expect(h.bookingState()?.['preferredDate']).toBe('2026-05-29');
    expect(h.bookingState()?.['preferredTime']).toBe('15:30');
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text.toLowerCase()).not.toMatch(/what time would you prefer/i);
    }
  });

  it('Scenario 8: NLU — 330pm speechless sets 15:30 and avoids generic “this detail” copy', async () => {
    const interpret = jest.fn(async (input: BookingNluInterpretInput): Promise<BookingNluOutput | null> => {
      if (/speechless/i.test(input.latestInboundText)) {
        return {
          intent: 'revise_time',
          confidence: 0.9,
          fields: {
            service: null,
            preferredDate: null,
            preferredTime: '15:30',
            preferredTimeWindow: null,
            name: null,
            phone: null,
            email: null,
            firstVisit: null,
            customAnswers: {},
          },
          slotSelection: { type: 'none', index: null, time: null },
          userFrustrated: true,
          notes: null,
        };
      }
      return null;
    });
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
      fetchFreeSlotsForAutomation: jest.fn(),
    } as unknown as BookingSettingsService;

    const h = new BookingConversationHarness(flowSvc(booking, {} as GhlService, undefined, { interpret }), {
      tenantId: 't1',
      conversationId: 'c_scen_8',
      contactId: 'ct1',
      channel: 'SMS',
    });
    h.reset({
      aisbp_booking: {
        status: 'collecting_details',
        version: 1,
        calendarId: 'cal_1',
        service: 'Haircut',
        preferredDate: '2026-05-29',
        customerName: 'Pat',
        phone: '+15551234567',
        pendingFieldId: 'preferred_time',
        pendingFieldRequired: true,
      },
    });
    const r = await h.say('330pm..... speechless');
    expect(r.handled).toBe(true);
    expect(h.bookingState()?.['preferredTime']).toBe('15:30');
    if (r.handled) {
      expect(r.replyPlan.bubbles[0]!.text).not.toMatch(/I['']?ll need this detail to continue/i);
    }
  });

  it('Scenario 9: NLU — anything also can maps to Anything for pending stylist field', async () => {
    const interpret = jest.fn(async (input: BookingNluInterpretInput): Promise<BookingNluOutput | null> => {
      if (input.latestInboundText.toLowerCase().includes('anything')) {
        return {
          intent: 'provide_field',
          confidence: 0.88,
          fields: {
            service: null,
            preferredDate: null,
            preferredTime: null,
            preferredTimeWindow: null,
            name: null,
            phone: null,
            email: null,
            firstVisit: null,
            customAnswers: { [STYLIST_FIELD_ID]: 'Anything' },
          },
          slotSelection: { type: 'none', index: null, time: null },
          userFrustrated: false,
          notes: null,
        };
      }
      return null;
    });
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
      fetchFreeSlotsForAutomation: jest.fn(),
    } as unknown as BookingSettingsService;

    const h = new BookingConversationHarness(flowSvc(booking, {} as GhlService, undefined, { interpret }), {
      tenantId: 't1',
      conversationId: 'c_scen_9',
      contactId: 'ct1',
      channel: 'SMS',
    });
    h.reset({
      aisbp_booking: {
        status: 'collecting_details',
        version: 1,
        calendarId: 'cal_1',
        service: 'Haircut',
        preferredDate: '2026-05-29',
        preferredTime: '15:30',
        customerName: 'Pat',
        phone: '+15551234567',
        pendingFieldId: `custom:${STYLIST_FIELD_ID}`,
        pendingFieldRequired: true,
      },
    });
    const r = await h.say('anything also can');
    expect(r.handled).toBe(true);
    const ca = h.bookingState()?.['customAnswers'] as Record<string, string> | undefined;
    expect(ca?.[STYLIST_FIELD_ID]).toBe('Anything');
  });

  it('Scenario 10: bare offered-slot index skips NLU (deterministic path)', async () => {
    const interpret = jest.fn(async (): Promise<BookingNluOutput | null> => null);
    const bookSlot = jest.fn(async () => ({ success: true, appointmentId: 'ap_scen_10' }));
    const offeredMorningUtc: AisbpOfferedSlot[] = [
      {
        option: 1,
        startIso: '2026-05-29T04:00:00.000Z',
        endIso: '2026-05-29T04:30:00.000Z',
        displayText: '12:00 PM',
        calendarId: 'cal_1',
      },
      {
        option: 2,
        startIso: '2026-05-29T04:30:00.000Z',
        endIso: '2026-05-29T05:00:00.000Z',
        displayText: '12:30 PM',
        calendarId: 'cal_1',
      },
      {
        option: 3,
        startIso: '2026-05-29T07:00:00.000Z',
        endIso: '2026-05-29T07:30:00.000Z',
        displayText: '3:00 PM',
        calendarId: 'cal_1',
      },
    ];
    const booking = {
      getBookingSettings: jest.fn(async () => scenarioTenantSettings()),
      fetchFreeSlotsForAutomation: jest.fn(async () => may29SlotFetch()),
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

    const h = new BookingConversationHarness(flowSvc(booking, ghl, undefined, { interpret }), {
      tenantId: 't1',
      conversationId: 'c_scen_10',
      contactId: 'ct1',
      channel: 'SMS',
      tenantTimeZone: 'Asia/Kuala_Lumpur',
    });
    h.reset({
      aisbp_booking: {
        status: 'offered_slots',
        version: 1,
        calendarId: 'cal_1',
        service: 'Haircut',
        preferredDate: '2026-05-29',
        preferredTime: '15:00',
        customerName: 'Pat',
        phone: '+15551234567',
        customAnswers: { [STYLIST_FIELD_ID]: 'Male' },
        firstVisit: 'yes',
        offeredSlots: offeredMorningUtc,
        offeredSlotsCrmTimeZone: 'Asia/Kuala_Lumpur',
        slotDurationMinutes: 30,
      },
    });
    const r = await h.say('3');
    expect(r.handled).toBe(true);
    expect(interpret).not.toHaveBeenCalled();
    expect(bookSlot).toHaveBeenCalledTimes(1);
  });
});
