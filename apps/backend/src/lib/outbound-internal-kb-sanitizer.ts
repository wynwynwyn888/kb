import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import { polishKbSnippetForCustomer } from './kb-faq-customer-text';
import { segmentKbContent } from './kb-chunk-interpretation';
import { INTERNAL_GUIDANCE_LINE_PATTERNS, stripInternalGuidanceFromText } from './kb-internal-guidance';

/** Detects a labelled raw internal document leaking into a customer reply. */
const RAW_INTERNAL_DOCUMENT = /\b(?:KNOWLEDGE BASE|SOURCE DOCUMENT|INTERNAL DOCUMENT)\b/i;

/** Phrases that must never appear verbatim in customer messages (last-line guard). */
export const OUTBOUND_VERBATIM_BLOCKLIST: RegExp[] = [
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
  if (RAW_INTERNAL_DOCUMENT.test(t) && t.length > 2200) return true;
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
    return '';
  }
  if (latestIntent === 'COMPLAINT') {
    return '';
  }
  const hours = collectSegmentTexts(kbChunks, 'operating_hours');
  if (hours.length) {
    const raw = hours[0]!.slice(0, 400);
    const p = polishKbSnippetForCustomer(raw);
    if (p) return p;
  }
  return '';
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
  if (blocked) return '';

  if (hadInternalInOriginal) {
    if (menuish && t.length >= 24 && !INTERNAL_GUIDANCE_LINE_PATTERNS.some(re => re.test(t))) {
      return t;
    }
    if (menuish) {
      return '';
    }
    return t.length >= 12 ? t : '';
  }

  if (menuish && RAW_INTERNAL_DOCUMENT.test(t) && t.length > 2200) {
    return `${t.slice(0, 1900).trim()}…\n\nWould you like more detail on a specific section?`;
  }

  const originalTrimmed = text.trim();
  if (!t.trim() && originalTrimmed && !blocked) {
    return originalTrimmed.length >= 12 ? originalTrimmed : '';
  }

  return t;
}
