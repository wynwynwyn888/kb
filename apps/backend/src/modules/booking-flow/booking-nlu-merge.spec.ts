import { describe, expect, it } from '@jest/globals';
import {
  mergeValidatedNluIntoBooking,
  BOOKING_NLU_MIN_MERGE_CONFIDENCE,
  bookingUserTextHasExplicitFourDigitYear,
} from './booking-nlu-merge';
import type { TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
import type { AisbpBookingStateV1 } from './conversation-booking-state';
import type { BookingNluOutput } from './booking-nlu.schema';

const STYLIST_ID = 'cf_stylist';

const mergeOpts = (
  latest: string,
  combined: string,
  crmTodayYmd: string,
  intent: BookingNluOutput['intent'] = 'provide_field',
) => ({
  minConfidence: BOOKING_NLU_MIN_MERGE_CONFIDENCE,
  intent,
  crmTodayYmd,
  latestInboundText: latest,
  combinedInboundText: combined,
});

const settings = (): TenantBookingSettingsDto => ({
  enabled: true,
  bookingMode: 'CHECK_AVAILABILITY',
  defaultGhlCalendarId: 'cal_1',
  defaultGhlCalendarName: 'Main',
  coreFieldsJson: {
    name: { enabled: true, required: true },
    phone: { enabled: true, required: true },
    email: { enabled: false, required: false },
    service: { enabled: true, required: true },
    preferred_date: { enabled: true, required: true },
    preferred_time: { enabled: true, required: true },
    first_visit: { enabled: false, required: false },
  },
  customFieldsJson: [
    {
      id: STYLIST_ID,
      label: 'Stylist',
      fieldType: 'single_select',
      options: ['Male', 'Female', 'Anything'],
      required: true,
      displayOrder: 0,
    },
  ],
  maxBookingsPerSlot: 1,
  serviceMenuOptions: ['Haircut', 'Colour'],
  internalBookingAlertEnabled: false,
  internalBookingAlertNumber: null,
  internalBookingAlertChannel: 'GHL_MESSAGE',
  internalBookingAlertTemplate: null,
});

function emptyFields(): BookingNluOutput['fields'] {
  return {
    service: null,
    preferredDate: null,
    preferredTime: null,
    preferredTimeWindow: null,
    name: null,
    phone: null,
    email: null,
    firstVisit: null,
    customAnswers: {},
  };
}

function out(p: Partial<BookingNluOutput>): BookingNluOutput {
  const fields = { ...emptyFields(), ...p.fields };
  return {
    intent: p.intent ?? 'provide_field',
    confidence: p.confidence ?? 0.92,
    fields,
    slotSelection: p.slotSelection ?? { type: 'none', index: null, time: null },
    userFrustrated: p.userFrustrated ?? false,
    notes: p.notes ?? null,
  };
}

describe('mergeValidatedNluIntoBooking', () => {
  it('ignores NLU when confidence is below min', () => {
    const booking: AisbpBookingStateV1 = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal_1',
    };
    const r = mergeValidatedNluIntoBooking(booking, settings(), out({ confidence: 0.3, fields: { service: 'Haircut' } }), {
      ...mergeOpts('', '', '2026-05-03'),
    });
    expect(booking.service).toBeUndefined();
    expect(r.mergedFieldKeys).toEqual([]);
    expect(r.skipReason).toBe('low_confidence');
  });

  it('applies service and time when confidence is high', () => {
    const booking: AisbpBookingStateV1 = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal_1',
    };
    const r = mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({
        fields: { service: 'Haircut', preferredDate: '2026-05-29', preferredTime: '15:30' },
      }),
      mergeOpts('', '', '2026-05-03'),
    );
    expect(booking.service).toBe('Haircut');
    expect(booking.preferredDate).toBe('2026-05-29');
    expect(booking.preferredTime).toBe('15:30');
    expect(booking.preferredTimeWindow).toBe('exact');
    expect(r.mergedFieldKeys.sort()).toEqual(['preferredDate', 'preferredTime', 'service'].sort());
  });

  it('maps custom single_select Anything when pending custom field matches', () => {
    const booking: AisbpBookingStateV1 = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal_1',
    };
    const r = mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({
        fields: {
          customAnswers: { [STYLIST_ID]: 'Anything' },
        },
      }),
      { ...mergeOpts('', '', '2026-05-03'), pendingFieldId: `custom:${STYLIST_ID}` },
    );
    expect(booking.customAnswers?.[STYLIST_ID]).toBe('Anything');
    expect(r.mergedFieldKeys).toContain(`customAnswers:${STYLIST_ID}`);
  });

  it('returns invalid_date when NLU date is not yyyy-mm-dd', () => {
    const booking: AisbpBookingStateV1 = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal_1',
    };
    const r = mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({ fields: { preferredDate: '29 May' } }),
      mergeOpts('29 May', '29 May', '2026-05-03'),
    );
    expect(booking.preferredDate).toBeUndefined();
    expect(r.skipReason).toBe('invalid_date');
  });

  it('A: repairs NLU wrong year from "29th may" to next May 29 in CRM year', () => {
    const booking: AisbpBookingStateV1 = { status: 'collecting_details', version: 1, calendarId: 'cal_1' };
    const latest = '29th may';
    const r = mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({ fields: { preferredDate: '2023-05-29' } }),
      mergeOpts(latest, latest, '2026-05-03'),
    );
    expect(booking.preferredDate).toBe('2026-05-29');
    expect(r.dateRepair?.oldDate).toBe('2023-05-29');
    expect(r.dateRepair?.newDate).toBe('2026-05-29');
    expect(r.mergedFieldKeys).toContain('preferredDate');
  });

  it('B: "1st june" with NLU wrong year resolves to upcoming June 1', () => {
    const booking: AisbpBookingStateV1 = { status: 'collecting_details', version: 1, calendarId: 'cal_1' };
    const latest = '1st june?';
    const r = mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({ fields: { preferredDate: '2023-06-01' } }),
      mergeOpts(latest, latest, '2026-05-03'),
    );
    expect(booking.preferredDate).toBe('2026-06-01');
    expect(r.dateRepair).toBeDefined();
    expect(r.mergedFieldKeys).toContain('preferredDate');
  });

  it('C: NLU 2023-05-29 + user text "29th may" => 2026-05-29', () => {
    const booking: AisbpBookingStateV1 = { status: 'collecting_details', version: 1, calendarId: 'cal_1' };
    const latest = '29th may';
    mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({ fields: { preferredDate: '2023-05-29' } }),
      mergeOpts(latest, latest, '2026-05-03'),
    );
    expect(booking.preferredDate).toBe('2026-05-29');
  });

  it('D: keeps explicit past calendar year from NLU when user typed that year', () => {
    const booking: AisbpBookingStateV1 = { status: 'collecting_details', version: 1, calendarId: 'cal_1' };
    const latest = 'book 15 Jan 2020 please';
    mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({ fields: { preferredDate: '2020-01-15' } }),
      mergeOpts(latest, latest, '2026-05-03'),
    );
    expect(booking.preferredDate).toBe('2020-01-15');
  });

  it('E: "29th may 330pm" => date 2026-05-29 + preferredTime 15:30 when NLU sends wrong year', () => {
    const booking: AisbpBookingStateV1 = { status: 'collecting_details', version: 1, calendarId: 'cal_1' };
    const latest = '29th may 330pm';
    mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({ fields: { preferredDate: '2023-05-29', preferredTime: '15:30' } }),
      mergeOpts(latest, latest, '2026-05-03'),
    );
    expect(booking.preferredDate).toBe('2026-05-29');
    expect(booking.preferredTime).toBe('15:30');
  });

  it('rejects implicit past ISO when text has no parseable date and no year', () => {
    const booking: AisbpBookingStateV1 = { status: 'collecting_details', version: 1, calendarId: 'cal_1' };
    const r = mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({ fields: { preferredDate: '2023-05-29' } }),
      mergeOpts('thanks', 'thanks', '2026-05-03'),
    );
    expect(booking.preferredDate).toBeUndefined();
    expect(r.skipReason).toBe('invalid_past_date');
  });

  it('overwrites preferredDate on revise_date_time after a no-slots date', () => {
    const booking: AisbpBookingStateV1 = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal',
      preferredDate: '2026-05-27',
      preferredTime: '09:00',
      noSlotsForDateYmd: '2026-05-27',
    };
    const r = mergeValidatedNluIntoBooking(
      booking,
      settings(),
      out({
        intent: 'revise_date_time',
        fields: { preferredDate: '2026-05-26' },
      }),
      mergeOpts('26th?', '26th?', '2026-05-20', 'revise_date_time'),
    );
    expect(r.mergedFieldKeys).toContain('preferredDate');
    expect(booking.preferredDate).toBe('2026-05-26');
    expect(booking.noSlotsForDateYmd).toBeUndefined();
  });
});

describe('bookingUserTextHasExplicitFourDigitYear', () => {
  it('detects four-digit years', () => {
    expect(bookingUserTextHasExplicitFourDigitYear('15 Jan 2020')).toBe(true);
    expect(bookingUserTextHasExplicitFourDigitYear('29th may')).toBe(false);
  });
});
