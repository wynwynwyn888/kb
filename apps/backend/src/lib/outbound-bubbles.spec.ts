import {
  normalizeShortMultilineBody,
  packPlainTextIntoOutboundBubbles,
} from './outbound-bubbles';

describe('outbound-bubbles', () => {
  describe('normalizeShortMultilineBody (alias of prepareCustomerFacingPlainTextForOutboundSplit)', () => {
    it('preserves blank lines between option lines and the closing question', () => {
      const raw =
        'Happy to help.\n\nA) Service Menu\n\nB) Address\n\nC) Hours\n\nWhich would you like?';
      const out = normalizeShortMultilineBody(raw);
      expect(out).toMatch(/Hours\n\nWhich would you like/);
      expect(out).toContain('A) Service Menu');
    });
  });

  describe('packPlainTextIntoOutboundBubbles', () => {
    it('returns one bubble for short menu list', () => {
      const normalized = normalizeShortMultilineBody(
        'Happy to help.\n\nA) One\n\nB) Two\n\nC) Three',
      );
      const bubbles = packPlainTextIntoOutboundBubbles(normalized);
      expect(bubbles.length).toBe(1);
    });

    it('produces 2–3 bubbles for long policy-style text', () => {
      const para = 'Policy clause one. Clause two. Clause three. ';
      const text = normalizeShortMultilineBody(`${para.repeat(120).trim()}\n\nSecond section here.`);
      const bubbles = packPlainTextIntoOutboundBubbles(text);
      expect(bubbles.length).toBeGreaterThanOrEqual(2);
      expect(bubbles.length).toBeLessThanOrEqual(3);
    });
  });
});
