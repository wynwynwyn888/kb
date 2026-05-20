import { describe, expect, it } from '@jest/globals';
import { buildBatchBookingDetailsAsk } from './booking-conversation-copy';
import {
  canCollectContactDetailsInBatch,
  isSchedulingTimeLocked,
  listBatchDetailsMissingFieldIds,
} from './booking-batch-details';
import type { AisbpBookingStateV1 } from './conversation-booking-state';

describe('booking batch details', () => {
  it('isSchedulingTimeLocked only when preferredTime is set', () => {
    const booking = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal',
      preferredTimeWindow: 'morning',
    } as AisbpBookingStateV1;
    expect(isSchedulingTimeLocked(booking)).toBe(false);
    booking.preferredTime = '15:00';
    expect(isSchedulingTimeLocked(booking)).toBe(true);
  });

  it('buildBatchBookingDetailsAsk lists fields as hyphen bullets on separate lines', () => {
    const msg = buildBatchBookingDetailsAsk({
      humanDate: '26 May',
      timeLabel: '3:00 PM',
      fields: [
        { id: 'name', label: 'Your contact name', required: true },
        { id: 'phone', label: 'Mobile number', required: true },
        { id: 'first_visit', label: 'Is this your first visit?', required: false },
      ],
    });
    expect(msg).toContain('26 May');
    expect(msg).toContain('3:00 PM');
    expect(msg).toMatch(/once you provide:\n\n-/);
    expect(msg).toContain('- Your contact name');
    expect(msg).toContain('- Mobile number');
    expect(msg).toContain('- Is this your first visit?');
    expect(msg.toLowerCase()).not.toContain('skip');
  });

  it('canCollectContactDetailsInBatch when time disabled after service and date are set', () => {
    const settings = {
      coreFieldsJson: {
        name: { enabled: true, required: true },
        phone: { enabled: true, required: true },
        email: { enabled: false, required: false },
        service: { enabled: true, required: true },
        preferred_date: { enabled: true, required: true },
        preferred_time: { enabled: false, required: false },
        first_visit: { enabled: false, required: false },
      },
      customFieldsJson: [],
    };
    const booking = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal',
      service: 'Haircut',
      preferredDate: '2026-05-21',
    } as AisbpBookingStateV1;
    expect(canCollectContactDetailsInBatch(settings, booking)).toBe(true);
  });

  it('listBatchDetailsMissingFieldIds defers contact fields until batch phase', () => {
    const settings = {
      coreFieldsJson: {
        name: { enabled: true, required: true },
        phone: { enabled: true, required: true },
        email: { enabled: false, required: false },
        service: { enabled: true, required: false },
        preferred_date: { enabled: true, required: false },
        preferred_time: { enabled: true, required: false },
        first_visit: { enabled: false, required: false },
      },
      customFieldsJson: [],
    };
    const booking = {
      status: 'collecting_details',
      version: 1,
      calendarId: 'cal',
      preferredDate: '2026-05-26',
    } as AisbpBookingStateV1;
    expect(listBatchDetailsMissingFieldIds(settings, booking)).toEqual([]);
    booking.preferredTime = '15:00';
    expect(listBatchDetailsMissingFieldIds(settings, booking)).toEqual(['name', 'phone']);
  });
});
