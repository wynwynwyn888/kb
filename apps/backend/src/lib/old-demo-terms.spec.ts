import { detectOldDemoTermsInText, OLD_DEMO_TERM_PATTERNS } from './old-demo-terms';

describe('old-demo-terms', () => {
  it('returns hit=false on empty/null/undefined input', () => {
    expect(detectOldDemoTermsInText(null)).toEqual({ hit: false, termsFound: [] });
    expect(detectOldDemoTermsInText(undefined)).toEqual({ hit: false, termsFound: [] });
    expect(detectOldDemoTermsInText('')).toEqual({ hit: false, termsFound: [] });
  });

  it('detects restaurant categories and brand names individually', () => {
    const r = detectOldDemoTermsInText(
      'Welcome to Ember & Soy. Our menu covers Starters, Mains, Desserts, Vegan options.',
    );
    expect(r.hit).toBe(true);
    expect(r.termsFound).toEqual(
      expect.arrayContaining([
        'ember',
        'ember_and_soy',
        'starters',
        'mains',
        'desserts',
        'vegan_options',
        'our_menu_covers',
      ]),
    );
  });

  it('passes clean salon prompt without matches', () => {
    const r = detectOldDemoTermsInText(
      'You are the AI receptionist for Lumière Hair Atelier. Offer haircuts, colour, and treatments.',
    );
    expect(r.hit).toBe(false);
    expect(r.termsFound).toEqual([]);
  });

  it('exposes a stable list of patterns', () => {
    expect(OLD_DEMO_TERM_PATTERNS.length).toBeGreaterThanOrEqual(8);
    for (const { key, re } of OLD_DEMO_TERM_PATTERNS) {
      expect(typeof key).toBe('string');
      expect(re).toBeInstanceOf(RegExp);
    }
  });
});
