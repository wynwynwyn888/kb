import { describe, expect, it } from '@jest/globals';
import type { CoreFieldToggle } from '../../lib/tenant-automation-validation';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import type { AisbpBookingStateV1, AisbpOfferedSlot } from './conversation-booking-state';
import { buildBookingSummaryText, formatFirstVisitForSummary, titleCaseServiceLine } from './booking-summary';

function core(all: boolean): Record<string, CoreFieldToggle> {
  const keys = ['name', 'phone', 'email', 'service', 'preferred_date', 'preferred_time', 'first_visit'] as const;
  const o: Record<string, CoreFieldToggle> = {} as Record<string, CoreFieldToggle>;
  for (const k of keys) o[k] = { enabled: all, required: false };
  return o;
}

const slot: AisbpOfferedSlot = {
  option: 1,
  startIso: '2026-05-22T01:00:00.000Z',
  endIso: '2026-05-22T01:30:00.000Z',
  displayText: '9:00 AM',
  calendarId: 'cal_1',
};

const baseBooking: AisbpBookingStateV1 = {
  status: 'confirmed',
  version: 1,
  calendarId: 'cal_1',
  customerName: 'Lucy',
  phone: '026234216',
  email: 'lucy@example.com',
  service: 'hair colour',
  preferredDate: '2026-05-22',
  preferredTime: '09:00',
  firstVisit: 'no',
};

describe('buildBookingSummaryText', () => {
  it('includes appointmentId, name, phone, service, date, time, firstVisit when those asks are enabled', () => {
    const t = buildBookingSummaryText({
      appointmentId: 'appt_505',
      bookingStatusLabel: 'Confirmed',
      booking: baseBooking,
      coreFieldsJson: core(true),
      customFieldsJson: [],
      conversationId: 'conv-1',
      calendarName: 'LUMI',
      appointmentOwner: 'Staff A',
      selectedSlot: slot,
      crmTimeZone: 'UTC',
    });
    expect(t).toContain('Booking ID: appt_505');
    expect(t).toContain('Customer name: Lucy');
    expect(t).toContain('Phone: 026234216');
    expect(t).toContain('Service: Hair Colour');
    expect(t).toContain('First visit: No');
    expect(t).toContain('Conversation ID: conv-1');
  });

  it('omits Email line when email ask is false', () => {
    const c = core(true);
    c['email'] = { enabled: false, required: false };
    const t = buildBookingSummaryText({
      appointmentId: 'x',
      bookingStatusLabel: 'Confirmed',
      booking: baseBooking,
      coreFieldsJson: c,
      customFieldsJson: [],
      conversationId: 'c',
      selectedSlot: slot,
      crmTimeZone: 'UTC',
    });
    expect(t).not.toMatch(/^Email:/m);
  });

  it('shows "-" for optional asked fields without value (first visit)', () => {
    const b: AisbpBookingStateV1 = {
      ...baseBooking,
      firstVisit: undefined,
      skippedFieldIds: [],
    };
    const t = buildBookingSummaryText({
      appointmentId: 'a',
      bookingStatusLabel: 'Confirmed',
      booking: b,
      coreFieldsJson: core(true),
      customFieldsJson: [],
      conversationId: 'c',
      selectedSlot: slot,
      crmTimeZone: 'UTC',
    });
    expect(t).toMatch(/First visit: -/);
  });

  it('includes custom fields when enabled and present', () => {
    const cf: CustomBookingFieldDto = {
      id: 'cf1',
      label: 'Hair length',
      fieldType: 'short_text',
      required: false,
      enabled: true,
      displayOrder: 0,
    };
    const b: AisbpBookingStateV1 = {
      ...baseBooking,
      customAnswers: { cf1: 'shoulder' },
    };
    const t = buildBookingSummaryText({
      appointmentId: 'a',
      bookingStatusLabel: 'Confirmed',
      booking: b,
      coreFieldsJson: core(false),
      customFieldsJson: [cf],
      conversationId: 'c',
      selectedSlot: slot,
      crmTimeZone: 'UTC',
    });
    expect(t).toContain('Custom fields:');
    expect(t).toContain('Hair length: shoulder');
  });

  it('titleCaseServiceLine title-cases words', () => {
    expect(titleCaseServiceLine('HAIR COLOUR')).toBe('Hair Colour');
  });

  it('formatFirstVisitForSummary maps yes/no and skipped', () => {
    expect(formatFirstVisitForSummary({ ...baseBooking, firstVisit: 'yes', skippedFieldIds: [] })).toBe('Yes');
    expect(
      formatFirstVisitForSummary({ ...baseBooking, firstVisit: undefined, skippedFieldIds: ['first_visit'] }),
    ).toBe('Skipped');
  });
});
