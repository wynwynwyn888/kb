import { describe, expect, it } from '@jest/globals';
import {
  applyPendingFieldAnswer,
  isOptionalSkipIntent,
  parseFirstVisitDirectAnswer,
} from './booking-pending-field';
import type { AisbpBookingStateV1 } from './conversation-booking-state';

describe('parseFirstVisitDirectAnswer', () => {
  it('accepts yes variants and strips trailing punctuation', () => {
    expect(parseFirstVisitDirectAnswer('yes')).toBe('yes');
    expect(parseFirstVisitDirectAnswer('yes?')).toBe('yes');
    expect(parseFirstVisitDirectAnswer('yeah')).toBe('yes');
    expect(parseFirstVisitDirectAnswer('yup')).toBe('yes');
    expect(parseFirstVisitDirectAnswer('correct')).toBe('yes');
  });

  it('accepts no and returning-style phrases', () => {
    expect(parseFirstVisitDirectAnswer('no')).toBe('no');
    expect(parseFirstVisitDirectAnswer('returning')).toBe('no');
    expect(parseFirstVisitDirectAnswer('existing customer')).toBe('no');
  });
});

describe('isOptionalSkipIntent', () => {
  it('detects common skip phrases', () => {
    expect(isOptionalSkipIntent('skip')).toBe(true);
    expect(isOptionalSkipIntent('SKIP')).toBe(true);
    expect(isOptionalSkipIntent('later')).toBe(true);
    expect(isOptionalSkipIntent("don't have")).toBe(true);
    expect(isOptionalSkipIntent('no thanks')).toBe(true);
  });

  it('does not treat bare "no" as skip', () => {
    expect(isOptionalSkipIntent('no')).toBe(false);
  });
});

describe('applyPendingFieldAnswer preferred_date', () => {
  it('rejects past calendar dates', () => {
    const booking: AisbpBookingStateV1 = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal_1',
      pendingFieldId: 'preferred_date',
      pendingFieldRequired: true,
    };
    const r = applyPendingFieldAnswer({
      booking,
      latest: '2026-04-01',
      todayYmd: '2026-05-01',
    });
    expect(r.answered).toBe(false);
    expect(booking.preferredDate).toBeUndefined();
  });
});

describe('applyPendingFieldAnswer optional skip', () => {
  it('marks optional phone skipped and clears pending', () => {
    const booking: AisbpBookingStateV1 = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal_1',
      customerName: 'Lucy',
      pendingFieldId: 'phone',
      pendingFieldRequired: false,
    };
    const r = applyPendingFieldAnswer({ booking, latest: 'skip', todayYmd: '2026-05-01' });
    expect(r.answered).toBe(true);
    expect(r.skippedOptional).toBe(true);
    expect(booking.pendingFieldId).toBeUndefined();
    expect(booking.skippedFieldIds).toContain('phone');
    expect(booking.optionalAskedFieldIds).toContain('phone');
  });

  it('does not skip when field is required', () => {
    const booking: AisbpBookingStateV1 = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal_1',
      pendingFieldId: 'phone',
      pendingFieldRequired: true,
    };
    const r = applyPendingFieldAnswer({ booking, latest: 'skip', todayYmd: '2026-05-01' });
    expect(r.answered).toBe(false);
    expect(booking.skippedFieldIds).toBeUndefined();
  });
});

describe('applyPendingFieldAnswer first_visit', () => {
  const baseBooking = (): AisbpBookingStateV1 => ({
    status: 'collecting_details',
    version: 1,
    calendarId: 'cal_1',
    pendingFieldId: 'first_visit',
    pendingFieldRequired: false,
  });

  it('maps yes and yes? to firstVisit yes', () => {
    const booking = baseBooking();
    expect(applyPendingFieldAnswer({ booking, latest: 'yes', todayYmd: '2026-05-01' }).answered).toBe(true);
    expect(booking.firstVisit).toBe('yes');
    expect(booking.pendingFieldId).toBeUndefined();

    const b2 = baseBooking();
    expect(applyPendingFieldAnswer({ booking: b2, latest: 'yes?', todayYmd: '2026-05-01' }).answered).toBe(true);
    expect(b2.firstVisit).toBe('yes');
  });

  it('maps no to firstVisit no', () => {
    const booking = baseBooking();
    expect(applyPendingFieldAnswer({ booking, latest: 'no', todayYmd: '2026-05-01' }).answered).toBe(true);
    expect(booking.firstVisit).toBe('no');
  });

  it('maps natural yes replies including fillers', () => {
    const booking = baseBooking();
    expect(
      applyPendingFieldAnswer({ booking, latest: 'yes first visit dear', todayYmd: '2026-05-01' }).answered,
    ).toBe(true);
    expect(booking.firstVisit).toBe('yes');
  });

  it('maps natural affirmative first-visit sentences', () => {
    const booking = baseBooking();
    expect(
      applyPendingFieldAnswer({ booking, latest: 'this is my first visit', todayYmd: '2026-05-01' }).answered,
    ).toBe(true);
    expect(booking.firstVisit).toBe('yes');
  });

  it('maps natural no / returning replies', () => {
    const b1 = baseBooking();
    expect(applyPendingFieldAnswer({ booking: b1, latest: 'not my first visit', todayYmd: '2026-05-01' }).answered).toBe(
      true,
    );
    expect(b1.firstVisit).toBe('no');

    const b2 = baseBooking();
    expect(
      applyPendingFieldAnswer({ booking: b2, latest: 'returning customer', todayYmd: '2026-05-01' }).answered,
    ).toBe(true);
    expect(b2.firstVisit).toBe('no');
  });

  it('pending preferred_date + 30/5 morning sets date, morning window, clears pending', () => {
    const booking = {
      status: 'collecting_details' as const,
      version: 1,
      calendarId: 'cal_1',
      pendingFieldId: 'preferred_date' as const,
      pendingFieldRequired: true,
    };
    const r = applyPendingFieldAnswer({
      booking,
      latest: '30/5 morning',
      todayYmd: '2026-05-01',
    });
    expect(r.answered).toBe(true);
    expect(booking.preferredDate).toBe('2026-05-30');
    expect(booking.preferredTimeWindow).toBe('morning');
    expect(booking.pendingFieldId).toBeUndefined();
  });

  it('pending preferred_time + morning sets window only', () => {
    const booking = {
      status: 'collecting_details' as const,
      version: 1,
      calendarId: 'cal_1',
      pendingFieldId: 'preferred_time' as const,
      pendingFieldRequired: true,
    };
    const r = applyPendingFieldAnswer({ booking, latest: 'morning', todayYmd: '2026-05-01' });
    expect(r.answered).toBe(true);
    expect(booking.preferredTimeWindow).toBe('morning');
    expect(booking.pendingFieldId).toBeUndefined();
  });

  it('pending service + menu: generic line is not accepted', () => {
    const booking = {
      status: 'collecting_details' as const,
      version: 1,
      calendarId: 'cal_1',
      pendingFieldId: 'service' as const,
      pendingFieldRequired: true,
    };
    const r = applyPendingFieldAnswer({
      booking,
      latest: 'I want to book',
      todayYmd: '2026-05-01',
      serviceMenuOptions: ['Haircut', 'Colour'],
    });
    expect(r.answered).toBe(false);
    expect(booking.service).toBeUndefined();
  });

  it('pending service + menu: haircut resolves to Haircut', () => {
    const booking = {
      status: 'collecting_details' as const,
      version: 1,
      calendarId: 'cal_1',
      pendingFieldId: 'service' as const,
      pendingFieldRequired: true,
    };
    const r = applyPendingFieldAnswer({
      booking,
      latest: 'haircut',
      todayYmd: '2026-05-01',
      serviceMenuOptions: ['Haircut', 'Colour'],
    });
    expect(r.answered).toBe(true);
    expect(booking.service).toBe('Haircut');
  });

  it('G: pending custom single_select with CSV options + male stores Male', () => {
    const booking = {
      status: 'collecting_details' as const,
      version: 1,
      calendarId: 'cal_1',
      pendingFieldId: 'custom:stylist_pref',
      pendingFieldRequired: true,
    };
    const cf = {
      id: 'stylist_pref',
      label: 'Preference',
      fieldType: 'single_select',
      required: true,
      enabled: true,
      displayOrder: 0,
      options: ['Male,Female,Anything'],
    };
    const r = applyPendingFieldAnswer({
      booking,
      latest: 'male',
      todayYmd: '2026-05-01',
      customFieldDef: cf,
    });
    expect(r.answered).toBe(true);
    expect(booking.customAnswers?.['stylist_pref']).toBe('Male');
  });

  it('pending stylist preference + "no. anything will do" => Anything', () => {
    const booking = {
      status: 'collecting_details' as const,
      version: 1,
      calendarId: 'cal_1',
      pendingFieldId: 'custom:stylist_pref' as const,
      pendingFieldRequired: true,
    };
    const cf = {
      id: 'stylist_pref',
      label: 'Stylist',
      fieldType: 'single_select' as const,
      required: true,
      enabled: true,
      displayOrder: 0,
      options: ['Male', 'Female', 'Anything'],
    };
    const r = applyPendingFieldAnswer({
      booking,
      latest: 'no. anything will do',
      combinedHint: 'no. anything will do',
      todayYmd: '2026-05-01',
      customFieldDef: cf,
    });
    expect(r.answered).toBe(true);
    expect(booking.customAnswers?.['stylist_pref']).toBe('Anything');
  });
});
