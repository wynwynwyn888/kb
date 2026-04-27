/**
 * Removes internal citation / debug lines that must never reach customers (SMS/WhatsApp).
 * Does not strip model thinking — use `stripModelThinking` separately.
 */

const LEADING_META_LINE = /^\s*(?:\(Source\s*:|Source\s*:|Knowledge\s*:|KB\s*:|Retrieved\s+from\s*:|Debug\s*:|Model\s*:|Provider\s*:|Reasoning\s*:)/i;

/** Parenthetical "(Source: …)" on one line (handles common FAQ titles without nested parens). */
const PAREN_SOURCE_CHUNK = /\s*\(\s*Source\s*:[^\n()]*\)/gi;

function stripMetaLines(text: string): string {
  return text
    .split('\n')
    .filter(line => !LEADING_META_LINE.test(line))
    .join('\n');
}

/**
 * Strip citation/debug labels from text destined for GHL/customers.
 * Safe to call after `stripModelThinking`; order should be thinking first, then this.
 */
export function stripCustomerFacingMeta(text: string): string {
  if (text == null || text === '') return '';

  let s = stripMetaLines(text);
  s = s.replace(PAREN_SOURCE_CHUNK, '');
  return s
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
