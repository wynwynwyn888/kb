import type { MemoryEntry } from '../modules/orchestration/dto/memory-entry';

const RE_MENU = /\b(menu|food|drink|dish|dishes|service)\b/i;
const RE_BOOK = /\b(book|booking|reserve|appointment|slot)\b/i;
const RE_PRICE = /\b(price|cost|how much|fee)\b/i;
const RE_HOURS = /\b(open|close|hour|hours)\b/i;

/**
 * One-sentence internal summary when AI generation is unavailable.
 * Avoids raw concatenation of customer lines.
 */
export function buildReadableFallbackInternalSummary(
  latestCustomerMessage: string,
  memory: MemoryEntry[],
): string {
  const lines = [...memory]
    .filter(m => m.role === 'user')
    .map(m => String(m.content ?? '').trim())
    .filter(Boolean)
    .slice(-5);
  const combined = `${lines.join('\n')} ${latestCustomerMessage}`.toLowerCase();

  const cues: string[] = [];
  if (RE_MENU.test(combined)) cues.push('the service menu');
  if (RE_BOOK.test(combined)) cues.push('booking or scheduling');
  if (RE_PRICE.test(combined)) cues.push('pricing');
  if (RE_HOURS.test(combined)) cues.push('business hours');

  const cuePhrase =
    cues.length > 0
      ? `Recent context suggests they were asking about ${cues.slice(0, 2).join(' and ')}.`
      : 'There is limited prior context in the captured lines.';

  return `The customer requested human assistance. ${cuePhrase}`.replace(/\s+/g, ' ').trim();
}
