import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import type { BookingCoreFieldKey } from '../../lib/tenant-automation-constants';
import type { AisbpBookingStateV1 } from './conversation-booking-state';
import {
  isSchedulingTimeLocked,
  listBatchDetailsMissingFieldIds,
  PRE_SCHEDULING_ASK_PRIORITY,
} from './booking-batch-details';

function readCoreValue(booking: AisbpBookingStateV1, key: BookingCoreFieldKey): string | undefined {
  switch (key) {
    case 'name':
      return booking.customerName;
    case 'phone':
      return booking.phone;
    case 'email':
      return booking.email;
    case 'first_visit':
      return booking.firstVisit;
    case 'service':
      return booking.service;
    case 'preferred_date':
      return booking.preferredDate;
    case 'preferred_time':
      return booking.preferredTime;
    default:
      return undefined;
  }
}

/** Service, date, and time (exact HH:mm or morning/afternoon window) are captured. */
export function isPreSchedulingIntakeComplete(
  settings: { coreFieldsJson: Record<string, { enabled?: boolean }> },
  booking: AisbpBookingStateV1,
): boolean {
  for (const key of PRE_SCHEDULING_ASK_PRIORITY) {
    const t = settings.coreFieldsJson[key];
    if (!t?.enabled) continue;
    if (key === 'preferred_time') {
      if (!isSchedulingTimeLocked(booking) && !booking.preferredTimeWindow?.trim()) return false;
      continue;
    }
    if (!readCoreValue(booking, key)?.trim()) return false;
  }
  return true;
}

/** Contact/custom batch ask is allowed after scheduling intake (including time window). */
export function canCollectContactDetailsInBatch(
  settings: { coreFieldsJson: Record<string, { enabled?: boolean }> },
  booking: AisbpBookingStateV1,
): boolean {
  return isPreSchedulingIntakeComplete(settings, booking);
}

/** No remaining contact/custom fields in the batch list. */
export function isContactIntakeComplete(
  settings: {
    coreFieldsJson: Record<string, { enabled?: boolean; required?: boolean }>;
    customFieldsJson: CustomBookingFieldDto[];
  },
  booking: AisbpBookingStateV1,
): boolean {
  if (!canCollectContactDetailsInBatch(settings, booking)) return false;
  return listBatchDetailsMissingFieldIds(settings, booking).length === 0;
}

/** Live GHL slot list only after scheduling + contact/custom intake. */
export function mayOfferLiveSlots(
  settings: {
    coreFieldsJson: Record<string, { enabled?: boolean; required?: boolean }>;
    customFieldsJson: CustomBookingFieldDto[];
  },
  booking: AisbpBookingStateV1,
): boolean {
  return isContactIntakeComplete(settings, booking);
}

export function clearSlotOfferState(booking: AisbpBookingStateV1): void {
  booking.offeredSlots = undefined;
  booking.offeredSlotsCrmTimeZone = undefined;
  booking.lastOfferedAt = undefined;
  booking.selectedSlot = undefined;
}
