import { describe, expect, it } from '@jest/globals';
import { applyPendingFieldAnswer, isOptionalSkipIntent } from './booking-pending-field';
import type { AisbpBookingStateV1 } from './conversation-booking-state';

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
