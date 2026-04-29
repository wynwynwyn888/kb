import { maybeCoalesceOutboundBubbles, WHATSAPP_SAFE_SINGLE_MESSAGE_MAX } from './outbound-coalesce';

describe('maybeCoalesceOutboundBubbles', () => {
  it('joins two bubbles with a blank line for channel parity', () => {
    const out = maybeCoalesceOutboundBubbles([
      { index: 0, text: 'A) One\nB) Two' },
      { index: 1, text: 'Which option?' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('A) One\nB) Two\n\nWhich option?');
  });

  it('does not coalesce when joined body exceeds cap', () => {
    const big = 'x'.repeat(Math.floor(WHATSAPP_SAFE_SINGLE_MESSAGE_MAX / 2) + 100);
    const out = maybeCoalesceOutboundBubbles([
      { index: 0, text: big },
      { index: 1, text: big },
    ]);
    expect(out).toHaveLength(2);
  });

  it('leaves a single bubble unchanged', () => {
    const one = [{ index: 0, text: 'Only' }];
    expect(maybeCoalesceOutboundBubbles(one)).toEqual(one);
  });
});
