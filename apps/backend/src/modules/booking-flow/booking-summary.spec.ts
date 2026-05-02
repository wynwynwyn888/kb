import { describe, expect, it } from '@jest/globals';
import type { CoreFieldToggle } from '../../lib/tenant-automation-validation';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import type { AisbpBookingStateV1, AisbpOfferedSlot } from './conversation-booking-state';
import {
  buildBookingSummaryText,
  coreFieldIncludedInSummary,
  customFieldIncludedInSummary,
  formatFirstVisitForSummary,
  titleCaseServiceLine,
} from './booking-summary';

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

const baseInput = () => ({
  appointmentId: 'appt_505',
  bookingStatusLabel: 'Confirmed',
  booking: baseBooking,
  coreFieldsJson: core(true),
  customFieldsJson: [] as CustomBookingFieldDto[],
  conversationContactSnapshot: { displayName: 'CRM Pat', phone: '+6510000001' },
  calendarName: 'LUMI',
  selectedSlot: slot,
  crmTimeZone: 'UTC',
});

describe('buildBookingSummaryText', () => {
  it('includes appointmentId, booking name/phone, service, date, time, firstVisit when those fields are asked', () => {
    const t = buildBookingSummaryText(baseInput());
    expect(t).toContain('Booking ID: appt_505');
    expect(t).toContain('Booking status: Confirmed');
    expect(t).toContain('Booking name: Lucy');
    expect(t).toContain('Booking phone: 026234216');
    expect(t).toContain('Service: Hair Colour');
    expect(t).toContain('First visit: No');
    expect(t).toContain('Source: AISBP booking assistant');
    expect(t).toContain('CRM contact name: CRM Pat');
    expect(t).toContain('CRM contact phone: +6510000001');
  });

  it('omits Email line when email is not asked and not required', () => {
    const c = core(true);
    c['email'] = { enabled: false, required: false };
    const t = buildBookingSummaryText({ ...baseInput(), coreFieldsJson: c });
    expect(t).not.toMatch(/Booking email:/);
  });

  it('includes email when required=true even if ask (enabled) is false', () => {
    const c = core(true);
    c['email'] = { enabled: false, required: true };
    const t = buildBookingSummaryText({ ...baseInput(), coreFieldsJson: c });
    expect(t).toContain('Booking email: lucy@example.com');
    expect(coreFieldIncludedInSummary(c, 'email')).toBe(true);
  });

  it('shows "-" for optional included fields without value (first visit)', () => {
    const b: AisbpBookingStateV1 = {
      ...baseBooking,
      firstVisit: undefined,
      skippedFieldIds: [],
    };
    const t = buildBookingSummaryText({ ...baseInput(), booking: b });
    expect(t).toMatch(/First visit: -/);
  });

  it('does not use CRM phone for Booking phone line (intake only)', () => {
    const b: AisbpBookingStateV1 = { ...baseBooking, phone: '' };
    const t = buildBookingSummaryText({
      ...baseInput(),
      booking: b,
      conversationContactSnapshot: { phone: '+999' },
    });
    expect(t).toMatch(/Booking phone: -/);
    expect(t).toContain('CRM contact phone: +999');
  });

  it('includes custom fields when enabled or required', () => {
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
      ...baseInput(),
      booking: b,
      coreFieldsJson: core(false),
      customFieldsJson: [cf],
    });
    expect(t).toContain('Custom fields:');
    expect(t).toContain('Hair length: shoulder');
  });

  it('includes custom field when required=true and enabled=false', () => {
    const cf: CustomBookingFieldDto = {
      id: 'cf2',
      label: 'Notes',
      fieldType: 'short_text',
      required: true,
      enabled: false,
      displayOrder: 0,
    };
    expect(customFieldIncludedInSummary(cf)).toBe(true);
    const t = buildBookingSummaryText({
      ...baseInput(),
      coreFieldsJson: core(false),
      customFieldsJson: [cf],
      booking: { ...baseBooking, customAnswers: { cf2: 'x' } },
    });
    expect(t).toContain('- Notes: x');
  });

  it('omits custom field when ask=false and required=false', () => {
    const cf: CustomBookingFieldDto = {
      id: 'cf3',
      label: 'Hidden',
      fieldType: 'short_text',
      required: false,
      enabled: false,
      displayOrder: 0,
    };
    const t = buildBookingSummaryText({
      ...baseInput(),
      customFieldsJson: [cf],
      booking: { ...baseBooking, customAnswers: { cf3: 'secret' } },
    });
    expect(t).not.toContain('Hidden');
  });

  it('never includes conversation id, appointment owner, or GHL contact id', () => {
    const t = buildBookingSummaryText(baseInput());
    expect(t).not.toMatch(/conversation id/i);
    expect(t).not.toMatch(/appointment owner/i);
    expect(t).not.toMatch(/\bct_/i);
  });

  it('Contacted from shows "-" when snapshot missing', () => {
    const t = buildBookingSummaryText({
      ...baseInput(),
      conversationContactSnapshot: undefined,
    });
    expect(t).toContain('CRM contact name: -');
    expect(t).toContain('CRM contact phone: -');
  });

  it('Contacted from never substitutes booking intake name or phone', () => {
    const b: AisbpBookingStateV1 = {
      ...baseBooking,
      customerName: 'Intake Only Name',
      phone: '+19998887777',
    };
    const t = buildBookingSummaryText({
      ...baseInput(),
      booking: b,
      conversationContactSnapshot: undefined,
    });
    expect(t).toContain('Booking name: Intake Only Name');
    expect(t).toContain('Booking phone: +19998887777');
    expect(t).toContain('CRM contact name: -');
    expect(t).toContain('CRM contact phone: -');
    expect(t).not.toContain('CRM contact name: Intake Only Name');
    expect(t).not.toContain('CRM contact phone: +19998887777');
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
