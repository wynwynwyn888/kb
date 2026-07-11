import { describe, expect, it } from '@jest/globals';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import {
  buildPreferredDateNeedAsk,
  formatCustomFieldBookingQuestion,
  formatServiceAskWithOptionalMenu,
} from './booking-conversation-copy';

describe('formatCustomFieldBookingQuestion', () => {
  it('uses the tenant-defined custom-field label without injecting an industry rewrite', () => {
    const cf: CustomBookingFieldDto = {
      id: 'f1',
      label: 'Any Preference for Male or Female stylist??',
      fieldType: 'single_select',
      required: false,
      enabled: true,
      displayOrder: 0,
      options: ['Male', 'Female', 'No preference'],
    };
    const t = formatCustomFieldBookingQuestion(cf, true);
    expect(t).toContain('Any preference for male or female stylist');
    expect(t).not.toContain('Do you have any stylist preference');
    expect(t).not.toMatch(/Quick one/i);
    expect(t).not.toContain('??');
    expect(t).toContain('Options: Male, Female, No preference');
    expect(t.toLowerCase()).not.toContain('skip');
  });

  it('I: splits comma-joined option string into spaced list', () => {
    const cf: CustomBookingFieldDto = {
      id: 'f2',
      label: 'Pick one',
      fieldType: 'single_select',
      required: false,
      enabled: true,
      displayOrder: 0,
      options: ['Male,Female,Anything'],
    };
    const t = formatCustomFieldBookingQuestion(cf, false);
    expect(t).toContain('Options: Male, Female, Anything');
  });

  it('I: formatServiceAskWithOptionalMenu lists each service on its own line', () => {
    const t = formatServiceAskWithOptionalMenu(['Haircut', 'Colour']);
    expect(t).toMatch(/A\)\s*Haircut/);
    expect(t).toMatch(/B\)\s*Colour/);
  });
});

describe('buildPreferredDateNeedAsk', () => {
  it('confirms inferred May 28 when service, name, and time are present', () => {
    const combined = 'i want to book 28th 9am morning, for hair colour, my name is quickesta';
    const r = buildPreferredDateNeedAsk({
      combined,
      latest: combined,
      crmTodayYmd: '2026-05-03',
      service: 'Hair Colour',
      customerName: 'Quickesta',
      phone: '01492391',
      preferredTime: '09:00',
    });
    expect(r.suggestedYmd).toBe('2026-05-28');
    expect(r.baseMessage).toContain('Hair Colour');
    expect(r.baseMessage).toContain('Quickesta');
    expect(r.baseMessage).toContain('28 May');
    expect(r.baseMessage).toMatch(/9:00/i);
  });

  it('falls back to generic date ask without rich context', () => {
    const r = buildPreferredDateNeedAsk({
      combined: 'when can i come',
      latest: 'when can i come',
      crmTodayYmd: '2026-05-03',
    });
    expect(r.baseMessage).toContain('What date');
    expect(r.suggestedYmd).toBeUndefined();
  });
});
