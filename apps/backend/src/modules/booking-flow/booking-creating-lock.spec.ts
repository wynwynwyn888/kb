import { describe, expect, it } from '@jest/globals';
import {
  BOOKING_CREATING_STALE_MS,
  bookingCreatingLockKey,
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

  it('builds stable redis lock keys', () => {
    expect(bookingCreatingLockKey('conv-1')).toBe('booking:creating:conv-1');
  });
});
