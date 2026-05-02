import { describe, expect, it } from '@jest/globals';
import { mergeValidatedNluIntoBooking, BOOKING_NLU_MIN_MERGE_CONFIDENCE } from './booking-nlu-merge';
import type { TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
import type { AisbpBookingStateV1 } from './conversation-booking-state';
import type { BookingNluOutput } from './booking-nlu.schema';

const STYLIST_ID = 'cf_stylist';

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
      minConfidence: BOOKING_NLU_MIN_MERGE_CONFIDENCE,
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
      { minConfidence: BOOKING_NLU_MIN_MERGE_CONFIDENCE },
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
      { minConfidence: BOOKING_NLU_MIN_MERGE_CONFIDENCE, pendingFieldId: `custom:${STYLIST_ID}` },
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
      { minConfidence: BOOKING_NLU_MIN_MERGE_CONFIDENCE },
    );
    expect(booking.preferredDate).toBeUndefined();
    expect(r.skipReason).toBe('invalid_date');
  });
});
