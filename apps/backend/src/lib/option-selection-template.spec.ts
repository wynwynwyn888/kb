import {
  buildOptionSelectionCustomerReply,
  descriptionForMidSentence,
  parseSelectedOptionTitleDescription,
} from './option-selection-template';

describe('parseSelectedOptionTitleDescription', () => {
  it('splits title: description (production daycare example)', () => {
    const p = parseSelectedOptionTitleDescription(
      'Daycare: Supervised care in a safe environment.',
    );
    expect(p.title).toBe('Daycare');
    // Trailing periods stripped so the template owns final punctuation
    expect(p.description).toBe('Supervised care in a safe environment');
  });

  it('supports spaced hyphen separator', () => {
    const p = parseSelectedOptionTitleDescription('Daycare - Supervised care in a safe environment.');
    expect(p.title).toBe('Daycare');
    expect(p.description).toBe('Supervised care in a safe environment');
  });

  it('title-only when no description after colon', () => {
    const p = parseSelectedOptionTitleDescription('Quick trim:');
    expect(p.title).toBe('Quick trim');
    expect(p.description).toBeNull();
  });

  it('whole line as title when no structured separator', () => {
    const p = parseSelectedOptionTitleDescription('Just a service name');
    expect(p.title).toBe('Just a service name');
    expect(p.description).toBeNull();
  });
});

describe('buildOptionSelectionCustomerReply', () => {
  it('produces daycare reply without duplicate periods or apologies', () => {
    const msg = buildOptionSelectionCustomerReply(
      parseSelectedOptionTitleDescription('Daycare: Supervised care in a safe environment.'),
    );
    expect(msg).toMatch(/^Sure — Daycare is supervised care in a safe environment\.\n\n/);
    expect(msg).not.toMatch(/\.\./);
    expect(msg.toLowerCase()).not.toContain("don't have");
    expect(msg).toMatch(/check availability|share more details about this service/i);
  });

  it('uses title-only template when description missing', () => {
    const msg = buildOptionSelectionCustomerReply(parseSelectedOptionTitleDescription('Haircut'));
    expect(msg).toBe('Sure — you selected Haircut.\n\nWould you like me to share more details?');
  });
});

describe('descriptionForMidSentence', () => {
  it('lowercases first letter only', () => {
    expect(descriptionForMidSentence('Supervised care here.')).toBe('supervised care here');
  });
});
