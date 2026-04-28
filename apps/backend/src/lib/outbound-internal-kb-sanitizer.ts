import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import { MENU_PROMPT_NO_KB } from '../modules/conversation-policy/policy-menu-copy';
import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import { polishKbSnippetForCustomer } from './kb-faq-customer-text';
import { segmentKbContent } from './kb-chunk-interpretation';
import { INTERNAL_GUIDANCE_LINE_PATTERNS, stripInternalGuidanceFromText } from './kb-internal-guidance';

/** Detects when a raw, very-large RESTAURANT MENU document body has leaked into the draft. */
const RAW_MENU_DUMP = /\bRESTAURANT MENU\b/i;

/** Phrases that must never appear verbatim in customer messages (last-line guard). */
export const OUTBOUND_VERBATIM_BLOCKLIST: RegExp[] = [
  /\bthe dining experience should feel\b/i,
  /\bwhen responding to guests\b/i,
  /\bkeep suggestions selective\b/i,
  /\buse this exact format\b/i,
  /\bSPECIAL\s*REQUEST\s*:/i,
  /\brecommendation\s*rules\s*:/i,
  /\bcomplaint\s*context\b/i,
  ...INTERNAL_GUIDANCE_LINE_PATTERNS,
];

function dedupeRegexes(res: RegExp[]): RegExp[] {
  const seen = new Set<string>();
  const out: RegExp[] = [];
  for (const r of res) {
    const k = r.source;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

const BLOCKLIST = dedupeRegexes(OUTBOUND_VERBATIM_BLOCKLIST);

export function outboundContainsHardKbLeak(text: string): boolean {
  const t = text ?? '';
  if (!t.trim()) return false;
  if (BLOCKLIST.some(re => re.test(t))) return true;
  if (RAW_MENU_DUMP.test(t) && t.length > 2800) return true;
  return false;
}

function collectSegmentTexts(chunks: RetrievalChunk[], kind: string): string[] {
  const out: string[] = [];
  for (const c of chunks) {
    for (const s of segmentKbContent(c.content ?? '')) {
      if (s.kind === kind) out.push(s.text.trim());
    }
  }
  return out.filter(Boolean);
}

/**
 * When outbound text is unsafe, rebuild a short reply using only structured KB facts.
 */
export function composeFactsOnlyFallbackFromKb(
  latestIntent: ConversationIntent,
  kbChunks: RetrievalChunk[],
): string {
  if (latestIntent === 'BUSINESS_HOURS') {
    const hours = collectSegmentTexts(kbChunks, 'operating_hours');
    if (hours.length) {
      const raw = hours.join('\n').slice(0, 520);
      return polishKbSnippetForCustomer(raw) || raw;
    }
  }
  if (latestIntent === 'LOCATION') {
    const addr = collectSegmentTexts(kbChunks, 'address');
    if (addr.length) return addr.join('\n').slice(0, 600);
  }
  if (latestIntent === 'MENU' || latestIntent === 'SHORT_SELECTION') {
    // Universal fallback — never names categories the tenant may not have.
    return MENU_PROMPT_NO_KB;
  }
  if (latestIntent === 'COMPLAINT') {
    return (
      "I'm sorry you've had a frustrating experience. I want to help get this sorted. " +
      'Could you share a bit more about what happened? I can also connect you with a manager if you prefer.'
    );
  }
  const hours = collectSegmentTexts(kbChunks, 'operating_hours');
  if (hours.length) {
    const raw = hours[0]!.slice(0, 400);
    const p = polishKbSnippetForCustomer(raw);
    if (p) return p;
  }
  return 'How can I help you today?';
}

/**
 * Last-line defense: block internal KB / raw menu document dumps from reaching customers.
 */
export function sanitizeOutboundInternalKbLeak(
  text: string,
  latestIntent: ConversationIntent,
  kbChunks?: RetrievalChunk[],
): string {
  const menuish = latestIntent === 'MENU' || latestIntent === 'SHORT_SELECTION';
  const hadInternalInOriginal = INTERNAL_GUIDANCE_LINE_PATTERNS.some(re => re.test(text));
  let t = stripInternalGuidanceFromText(text);
  const blocked = outboundContainsHardKbLeak(text) || outboundContainsHardKbLeak(t);

  if (blocked && kbChunks && kbChunks.length > 0) {
    return composeFactsOnlyFallbackFromKb(latestIntent, kbChunks);
  }

  if (hadInternalInOriginal) {
    if (menuish && t.length >= 24 && !INTERNAL_GUIDANCE_LINE_PATTERNS.some(re => re.test(t))) {
      return t;
    }
    if (menuish) {
      return MENU_PROMPT_NO_KB;
    }
    return t.length >= 12 ? t : 'How can I help you today?';
  }

  if (menuish && RAW_MENU_DUMP.test(t) && t.length > 2200) {
    // Truncate the leak and ask the customer what they want, without inventing categories.
    return (
      `${t.slice(0, 1900).trim()}…\n\n` +
      'Would you like more detail on a specific section?'
    );
  }

  return t;
}
