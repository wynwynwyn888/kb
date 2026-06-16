import type { AisbpBookingStateV1 } from './conversation-booking-state';

/** GHL book in-flight guard — stale after 3 minutes so a crashed worker can recover. */
export const BOOKING_CREATING_STALE_MS = 3 * 60 * 1000;

export function isBookingCreatingInFlight(booking: AisbpBookingStateV1 | null | undefined): boolean {
  if (!booking || booking.status !== 'creating') return false;
  const started = booking.creatingStartedAt ? Date.parse(booking.creatingStartedAt) : 0;
  if (!Number.isFinite(started)) return false;
  return Date.now() - started <= BOOKING_CREATING_STALE_MS;
}

/** Reset stale or corrupt `creating` state so the customer can retry booking. */
export function healStaleCreatingBookingState(booking: AisbpBookingStateV1): boolean {
  if (booking.status !== 'creating') return false;
  if (isBookingCreatingInFlight(booking)) return false;
  booking.status = booking.offeredSlots?.length ? 'offered_slots' : 'collecting_details';
  booking.creatingStartedAt = undefined;
  return true;
}

export function bookingCreatingLockKey(conversationId: string): string {
  return `booking:creating:${conversationId.trim()}`;
}

/** Cross-conversation guard while checking/enforcing per-slot booking caps. */
export function bookingTenantSlotLockKey(
  tenantId: string,
  calendarId: string,
  startIso: string,
): string {
  const ms = Date.parse(startIso);
  const bucket = Number.isFinite(ms) ? String(Math.floor(ms / 60_000)) : startIso.trim().slice(0, 32);
  return `booking:slot:${tenantId.trim()}:${calendarId.trim()}:${bucket}`;
}
