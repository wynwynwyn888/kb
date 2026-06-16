import { describe, expect, it } from '@jest/globals';
import {
  BOOKING_CREATING_STALE_MS,
  bookingCreatingLockKey,
  bookingTenantSlotLockKey,
  isBookingCreatingInFlight,
} from './booking-creating-lock';
import type { AisbpBookingStateV1 } from './conversation-booking-state';

describe('booking-creating-lock', () => {
  it('detects in-flight creating status within stale window', () => {
    const booking = {
      status: 'creating',
      creatingStartedAt: new Date().toISOString(),
    } as AisbpBookingStateV1;
    expect(isBookingCreatingInFlight(booking)).toBe(true);
  });

  it('treats stale creating as not in-flight', () => {
    const booking = {
      status: 'creating',
      creatingStartedAt: new Date(Date.now() - BOOKING_CREATING_STALE_MS - 1000).toISOString(),
    } as AisbpBookingStateV1;
    expect(isBookingCreatingInFlight(booking)).toBe(false);
  });

  it('treats invalid creatingStartedAt as not in-flight', () => {
    const booking = {
      status: 'creating',
      creatingStartedAt: 'not-a-date',
    } as AisbpBookingStateV1;
    expect(isBookingCreatingInFlight(booking)).toBe(false);
  });

  it('builds stable redis lock keys', () => {
    expect(bookingCreatingLockKey('conv-1')).toBe('booking:creating:conv-1');
  });

  it('builds tenant slot lock keys from calendar and start time', () => {
    const key = bookingTenantSlotLockKey('t1', 'cal-1', '2026-05-27T09:00:00.000Z');
    expect(key).toMatch(/^booking:slot:t1:cal-1:/);
  });
});
