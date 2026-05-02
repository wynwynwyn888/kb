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
});
