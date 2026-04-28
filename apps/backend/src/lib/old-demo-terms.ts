/**
 * Detect well-known restaurant/agency demo seed phrases inside an active prompt config so we can
 * surface "the wrong demo prompt is loaded" warnings without ever printing the prompt body.
 *
 * Used only for safe orchestration logs. The list is intentionally narrow — it targets the
 * phrases reported in production (Ember & Soy demo) and explicit category nouns we never want
 * the bot to volunteer in non-restaurant verticals.
 */

export const OLD_DEMO_TERM_PATTERNS: ReadonlyArray<{ key: string; re: RegExp }> = [
  { key: 'ember', re: /\bEmber\b/ },
  { key: 'ember_and_soy', re: /\bEmber\s*&\s*Soy\b/i },
  { key: 'sage', re: /\bSage\b/ },
  { key: 'starters', re: /\bStarters?\b/ },
  { key: 'mains', re: /\bMains?\b/ },
  { key: 'desserts', re: /\bDesserts?\b/ },
  { key: 'vegan_options', re: /\bVegan\s+options?\b/i },
  { key: 'dining_concierge', re: /\bdining\s+concierge\b/i },
  { key: 'restaurant_menu', re: /\brestaurant\s+menu\b/i },
  { key: 'our_menu_covers', re: /\bour\s+menu\s+covers\b/i },
  { key: 'happy_to_help_with_our_menu', re: /\bHappy\s+to\s+help\s+with\s+our\s+menu\b/i },
];

export interface OldDemoTermsFinding {
  /** True when at least one term matched. */
  hit: boolean;
  /** Stable keys for the matched patterns (for safe structured logs). */
  termsFound: string[];
}

export function detectOldDemoTermsInText(text: string | null | undefined): OldDemoTermsFinding {
  if (!text) return { hit: false, termsFound: [] };
  const found: string[] = [];
  for (const { key, re } of OLD_DEMO_TERM_PATTERNS) {
    if (re.test(text)) found.push(key);
  }
  return { hit: found.length > 0, termsFound: found };
}
