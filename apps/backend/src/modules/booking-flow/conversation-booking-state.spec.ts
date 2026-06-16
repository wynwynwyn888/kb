import { describe, expect, it } from '@jest/globals';
import {
  mergeBookingIntoConversationMetadata,
  type AisbpBookingStateV1,
} from './conversation-booking-state';

const baseBooking = (): AisbpBookingStateV1 => ({
  status: 'collecting_details',
  version: 1,
  calendarId: 'cal_1',
});

describe('mergeBookingIntoConversationMetadata version bump', () => {
  it('keeps version 1 on first persist', () => {
    const merged = mergeBookingIntoConversationMetadata({}, baseBooking());
    const b = merged['aisbp_booking'] as AisbpBookingStateV1;
    expect(b.version).toBe(1);
  });

  it('bumps version when booking state materially changes', () => {
    const prev = mergeBookingIntoConversationMetadata({}, baseBooking());
    const next = mergeBookingIntoConversationMetadata(prev, {
      ...baseBooking(),
      service: 'Haircut',
    });
    const b = next['aisbp_booking'] as AisbpBookingStateV1;
    expect(b.version).toBe(2);
    expect(b.service).toBe('Haircut');
  });

  it('preserves explicit higher incoming version', () => {
    const prev = mergeBookingIntoConversationMetadata({}, { ...baseBooking(), version: 2 });
    const next = mergeBookingIntoConversationMetadata(prev, {
      ...baseBooking(),
      status: 'confirmed',
      version: 5,
      appointmentId: 'ap_1',
    });
    const b = next['aisbp_booking'] as AisbpBookingStateV1;
    expect(b.version).toBe(5);
  });

  it('does not bump when fingerprint unchanged', () => {
    const prev = mergeBookingIntoConversationMetadata({}, { ...baseBooking(), version: 3 });
    const next = mergeBookingIntoConversationMetadata(prev, { ...baseBooking(), version: 1 });
    const b = next['aisbp_booking'] as AisbpBookingStateV1;
    expect(b.version).toBe(3);
  });
});
