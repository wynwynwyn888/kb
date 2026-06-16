import type { AisbpBookingStateV1 } from './conversation-booking-state';

/** GHL book in-flight guard — stale after 3 minutes so a crashed worker can recover. */
export const BOOKING_CREATING_STALE_MS = 3 * 60 * 1000;

export function isBookingCreatingInFlight(booking: AisbpBookingStateV1 | null | undefined): boolean {
  if (!booking || booking.status !== 'creating') return false;
  const started = booking.creatingStartedAt ? Date.parse(booking.creatingStartedAt) : 0;
  if (!Number.isFinite(started)) return true;
  return Date.now() - started <= BOOKING_CREATING_STALE_MS;
}

export function bookingCreatingLockKey(conversationId: string): string {
  return `booking:creating:${conversationId.trim()}`;
}
