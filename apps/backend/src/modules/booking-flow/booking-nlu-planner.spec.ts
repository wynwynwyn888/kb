import { describe, expect, it } from '@jest/globals';
import {
  planBookingTurnFromNlu,
  userMessageImpliesAvailabilityDiscovery,
} from './booking-nlu-planner';
import type { BookingNluOutput } from './booking-nlu.schema';
import type { AisbpBookingStateV1 } from './conversation-booking-state';

function nlu(p: Partial<BookingNluOutput>): BookingNluOutput {
  return {
    intent: p.intent ?? 'unknown',
    confidence: p.confidence ?? 0.9,
    fields: {
      service: null,
      preferredDate: null,
      preferredTime: null,
      preferredTimeWindow: null,
      name: null,
      phone: null,
      email: null,
      firstVisit: null,
      customAnswers: {},
      ...p.fields,
    },
    slotSelection: p.slotSelection ?? { type: 'none', index: null, time: null },
    userFrustrated: p.userFrustrated ?? false,
    notes: p.notes ?? null,
  };
}

describe('booking-nlu-planner', () => {
  it('detects availability discovery phrasing', () => {
    expect(userMessageImpliesAvailabilityDiscovery('u tell me when u are available')).toBe(true);
    expect(userMessageImpliesAvailabilityDiscovery('can u tell me which date ure available')).toBe(true);
    expect(userMessageImpliesAvailabilityDiscovery('26th?')).toBe(false);
  });

  it('plans wide discovery after no_slots failure', () => {
    const booking = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal',
      preferredDate: '2026-05-27',
      preferredTime: '09:00',
      noSlotsForDateYmd: '2026-05-27',
    } as AisbpBookingStateV1;
    const plan = planBookingTurnFromNlu({
      nlu: nlu({ intent: 'request_availability' }),
      booking,
      latestInboundText: 'when are you available',
    });
    expect(plan).toEqual({ type: 'discover_availability', wideRange: true });
  });

  it('plans confirm_single_slot for confirm_offer with one offered slot', () => {
    const booking = {
      status: 'offered_slots',
      version: 1,
      calendarId: 'cal',
      preferredDate: '2026-05-27',
      offeredSlots: [
        {
          option: 1,
          startIso: '2026-05-27T07:00:00.000Z',
          endIso: '2026-05-27T07:30:00.000Z',
          displayText: '3:00 PM',
          calendarId: 'cal',
        },
      ],
    } as AisbpBookingStateV1;
    const plan = planBookingTurnFromNlu({
      nlu: nlu({ intent: 'confirm_offer' }),
      booking,
      latestInboundText: 'yes please',
    });
    expect(plan).toEqual({ type: 'confirm_single_slot' });
  });
});
