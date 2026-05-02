import { describe, expect, it } from '@jest/globals';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import { formatCustomFieldBookingQuestion } from './booking-conversation-copy';

describe('formatCustomFieldBookingQuestion', () => {
  it('polishes awkward stylist label and lists single_select options', () => {
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
    expect(t).toContain('Do you have a preference for a male or female stylist');
    expect(t).not.toMatch(/Quick one/i);
    expect(t).not.toContain('??');
    expect(t).toContain('Options: Male, Female, No preference');
    expect(t.toLowerCase()).toContain('skip');
  });
});
