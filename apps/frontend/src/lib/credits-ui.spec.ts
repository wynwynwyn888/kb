import { describe, expect, it } from 'vitest';
import { creditStatusLabel, formatSignedInt } from './credits-ui';

describe('credits-ui', () => {
  it('maps status to client-facing labels', () => {
    expect(creditStatusLabel('ACTIVE')).toBe('Active');
    expect(creditStatusLabel('LOW_CREDIT')).toBe('Low credit');
    expect(creditStatusLabel('PAUSED_NO_CREDITS')).toBe('Paused');
    expect(creditStatusLabel('NEGATIVE_ALLOWED')).toBe('Within overage allowance');
    expect(creditStatusLabel('OVER_NEGATIVE_LIMIT')).toBe('Over limit');
  });

  it('formats signed integers with + for positives', () => {
    expect(formatSignedInt(10)).toBe('+10');
    expect(formatSignedInt(-3)).toBe('-3');
    expect(formatSignedInt(0)).toBe('0');
  });
});

