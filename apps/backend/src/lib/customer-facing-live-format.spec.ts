import {
  normalizeExcessiveBlankLines,
  prepareCustomerFacingPlainTextForOutboundSplit,
  stripLiveCustomerMarkdownForOutbound,
} from './customer-facing-live-format';
import { packPlainTextIntoOutboundBubbles } from './outbound-bubbles';

describe('customer-facing-live-format', () => {
  it('list block + final question keeps a blank line through prepare + pack', () => {
    const raw =
      'A) Haircut and Styling\n\nB) Colour Services\n\nC) Perm and Rebonding\n\nD) Hair and Scalp Treatments\n\nWhich category would you like to explore?';
    const prepared = prepareCustomerFacingPlainTextForOutboundSplit(
      stripLiveCustomerMarkdownForOutbound(raw),
    );
    const bubbles = packPlainTextIntoOutboundBubbles(prepared);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]!.text).toMatch(/Treatments\n\nWhich category/);
  });

  it('price answer + next-step question keeps a blank line', () => {
    const raw =
      'Our basic cut starts at **forty five dollars**.' + '\n\n' + 'Would you like to book a time?';
    const prepared = prepareCustomerFacingPlainTextForOutboundSplit(
      stripLiveCustomerMarkdownForOutbound(raw),
    );
    expect(prepared).toMatch(/\*forty five dollars\*\.\n\nWould you like/);
  });

  it('markdown stripping keeps paragraph breaks and WhatsApp bold', () => {
    const out = stripLiveCustomerMarkdownForOutbound('Hello **there**\n\nSecond paragraph.');
    expect(out).toContain('Hello *there*');
    expect(out).toContain('Second paragraph.');
    expect(out).toMatch(/\*there\*\n\nSecond/);
  });

  it('recommendation answer + next question keeps a blank line', () => {
    const raw =
      'For damaged hair we suggest a bonding treatment first.\n\nWould you like to book a consultation?';
    const prepared = prepareCustomerFacingPlainTextForOutboundSplit(
      stripLiveCustomerMarkdownForOutbound(raw),
    );
    expect(prepared).toMatch(/first\.\n\nWould you like/);
  });

  it('normalizes excessive blank lines without removing all spacing', () => {
    const raw = 'Line one\n\n\n\n\nLine two';
    expect(normalizeExcessiveBlankLines(raw)).toBe('Line one\n\nLine two');
  });

  it('keeps existing • bullets and blank lines', () => {
    const raw = 'Head\n\n• One\n• Two\n\nTail';
    const out = stripLiveCustomerMarkdownForOutbound(raw);
    expect(out).toContain('• One');
    expect(out).toMatch(/Two\n\nTail/);
  });

  it('preserves inline WhatsApp bold with single asterisks', () => {
    expect(stripLiveCustomerMarkdownForOutbound('The *best next step* is a call.')).toBe(
      'The *best next step* is a call.',
    );
  });

  it('normalizes double-asterisk bold to WhatsApp bold', () => {
    expect(stripLiveCustomerMarkdownForOutbound('The **best next step** is a call.')).toBe(
      'The *best next step* is a call.',
    );
  });
});
