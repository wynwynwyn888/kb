import { sanitizeOutboundInternalKbLeak } from './outbound-internal-kb-sanitizer';

describe('outbound-internal-kb-sanitizer', () => {
  it('5: strips internal guidance phrases from outbound', () => {
    const dirty =
      'When responding to customers, stay warm.\n\nHere are the options:\n\nA) Basic\nB) Premium';
    const out = sanitizeOutboundInternalKbLeak(dirty, 'MENU');
    expect(out).not.toMatch(/When responding to customers/i);
  });

  it('trims a huge labelled internal-document paste', () => {
    const body = 'INTERNAL DOCUMENT\n' + 'x'.repeat(2400);
    const out = sanitizeOutboundInternalKbLeak(body, 'MENU');
    expect(out).toBe('');
  });

  it('does not empty short ALL-CAPS live replies after sanitization', () => {
    const out = sanitizeOutboundInternalKbLeak("YOU'RE WELCOME!", 'UNKNOWN');
    expect(out).toBe("YOU'RE WELCOME!");
  });
});
