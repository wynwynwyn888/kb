import {
  normalizeShortMultilineBody,
  packPlainTextIntoOutboundBubbles,
} from './outbound-bubbles';

describe('outbound-bubbles', () => {
  describe('normalizeShortMultilineBody', () => {
    it('joins short menu lines separated by blank lines', () => {
      const raw =
        'Happy to help with our menu.\n\nA) Starters\n\nB) Mains\n\nC) Desserts\n\nWhat next?';
      const out = normalizeShortMultilineBody(raw);
      expect(out).toContain('A) Starters\nB) Mains');
      expect(out.startsWith('Happy to help')).toBe(true);
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
