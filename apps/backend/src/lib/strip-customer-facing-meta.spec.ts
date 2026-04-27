import { stripCustomerFacingMeta } from '@aisbp/formatter';

describe('stripCustomerFacingMeta', () => {
  it('removes a dedicated (Source: …) line', () => {
    const s = stripCustomerFacingMeta(
      'We open at 9.\n\n(Source: FAQ: What are your opening hours?)\n\nThanks!',
    );
    expect(s).not.toMatch(/Source/i);
    expect(s).toContain('9');
    expect(s).toContain('Thanks');
  });

  it('removes Source: prefixed lines', () => {
    expect(stripCustomerFacingMeta('Hi\nSource: KB doc\nBye')).not.toContain('Source');
  });

  it('removes inline parenthetical Source chunk', () => {
    expect(stripCustomerFacingMeta('Hello (Source: FAQ: Hours)')).toBe('Hello');
  });
});
