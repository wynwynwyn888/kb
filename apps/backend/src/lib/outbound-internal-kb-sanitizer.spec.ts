import { sanitizeOutboundInternalKbLeak } from './outbound-internal-kb-sanitizer';

describe('outbound-internal-kb-sanitizer', () => {
  it('5: strips internal guidance phrases from outbound', () => {
    const dirty =
      'When responding to guests, stay warm.\n\nHere is the menu:\n\nA) Soup\nB) Salad';
    const out = sanitizeOutboundInternalKbLeak(dirty, 'MENU');
    expect(out).not.toMatch(/When responding to guests/i);
  });

  it('trims huge RESTAURANT MENU paste for menu intent', () => {
    const body = 'RESTAURANT MENU\n' + 'x'.repeat(2400);
    const out = sanitizeOutboundInternalKbLeak(body, 'MENU');
    expect(out.length).toBeLessThan(body.length);
    expect(out).toMatch(/\?$/m);
  });

  it('does not empty short ALL-CAPS live replies after sanitization', () => {
    const out = sanitizeOutboundInternalKbLeak("YOU'RE WELCOME!", 'UNKNOWN');
    expect(out).toBe("YOU'RE WELCOME!");
  });
});
