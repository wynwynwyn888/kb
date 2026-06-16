import type { BookingNluOutput } from './booking-nlu.schema';
import type { AisbpBookingStateV1 } from './conversation-booking-state';

/** Minimum confidence before NLU drives orchestration (field merge may use a lower bar). */
export const BOOKING_NLU_MIN_PLAN_CONFIDENCE = 0.6;

export type BookingNluTurnAction =
  | { type: 'none' }
  | { type: 'discover_availability'; wideRange: boolean }
  | { type: 'confirm_single_slot' }
  | { type: 'select_slot_from_nlu'; option?: number; timeHm?: string }
  | { type: 'refetch_slots_after_schedule_change' };

/** Heuristic when model used ask_question but user clearly wants openings. */
export function userMessageImpliesAvailabilityDiscovery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return /\b(when\s+(are\s+)?you\s+available|what\s+(dates?|times?|days?)\s+(are\s+)?(you\s+)?available|what\s+time\s+(do\s+)?(u|you)\s+have|which\s+(date|times?)|tell\s+me\s+(when|what|which)|any\s+openings?|show\s+(me\s+)?(available|open|slots)|u\s+tell\s+me\s+when|can\s+you\s+tell\s+me\s+which|more\s+slots?|other\s+(times?|slots?)|do\s+(u|you)\s+have\s+(more|any|other)|any\s+other\s+(times?|slots?))\b/.test(
    t,
  );
}

export function nluAllowsSchedulingOverwrite(
  intent: BookingNluOutput['intent'],
  booking: AisbpBookingStateV1,
): boolean {
  if (intent === 'revise_date_time' || intent === 'revise_time' || intent === 'request_availability') {
    return true;
  }
  if (booking.noSlotsForDateYmd?.trim()) {
    return intent === 'provide_field' || intent === 'ask_question' || intent === 'select_slot';
  }
  return false;
}

/**
 * Decide what the booking host should do after NLU merge — intent-first, deterministic safety net.
 */
export function planBookingTurnFromNlu(params: {
  nlu: BookingNluOutput;
  booking: AisbpBookingStateV1;
  latestInboundText: string;
}): BookingNluTurnAction {
  const { nlu, booking, latestInboundText } = params;
  if (nlu.confidence < BOOKING_NLU_MIN_PLAN_CONFIDENCE) {
    return { type: 'none' };
  }

  const intent = nlu.intent;
  const latest = latestInboundText.trim();

  if (
    intent === 'request_availability' ||
    (intent === 'ask_question' &&
      (userMessageImpliesAvailabilityDiscovery(latest) ||
        userMessageImpliesAvailabilityDiscovery(nlu.notes ?? '')))
  ) {
    const hasFailedDate = Boolean(booking.noSlotsForDateYmd?.trim());
    const intakeReady = Boolean(booking.preferredDate?.trim());
    if (hasFailedDate || intakeReady) {
      return { type: 'discover_availability', wideRange: true };
    }
  }

  if (booking.status === 'offered_slots' && booking.offeredSlots?.length) {
    if (intent === 'confirm_offer') {
      if (booking.offeredSlots.length === 1) return { type: 'confirm_single_slot' };
    }
    if (intent === 'select_slot') {
      const sel = nlu.slotSelection;
      if (sel.type === 'index' && sel.index != null && sel.index >= 1 && sel.index <= 9) {
        return { type: 'select_slot_from_nlu', option: sel.index };
      }
      if (sel.type === 'time' && sel.time?.trim()) {
        return { type: 'select_slot_from_nlu', timeHm: sel.time.trim() };
      }
    }
  }

  if (
    intent === 'revise_date_time' ||
    intent === 'revise_time' ||
    (intent === 'provide_field' && nluAllowsSchedulingOverwrite(intent, booking))
  ) {
    const f = nlu.fields;
    if (f.preferredDate?.trim() || f.preferredTime?.trim() || f.preferredTimeWindow) {
      return { type: 'refetch_slots_after_schedule_change' };
    }
    if (nluAllowsSchedulingOverwrite(intent, booking) && latest) {
      return { type: 'refetch_slots_after_schedule_change' };
    }
  }

  return { type: 'none' };
}
