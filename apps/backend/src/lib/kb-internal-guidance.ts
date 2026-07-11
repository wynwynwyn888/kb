/**
 * Detects tenant brand / persona / ops instructions mixed into KB documents.
 * Those lines inform tone but must not be pasted to customers verbatim.
 */

import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';

/** Paragraphs/lines matching these are dropped from customer-facing KB text. */
export const INTERNAL_GUIDANCE_LINE_PATTERNS: RegExp[] = [
  /\bwhen responding to (?:customers|users|clients)\b/i,
  /\b(?:customers|users|clients) should feel\b/i,
  /\btone of voice\b/i,
  /\binternal use only\b/i,
  /\bdo not (?:say|tell|share)\b.*\b(?:customer|user|client)\b/i,
  /\buse this exact format\b/i,
  /\bspecial\s*request\s*:/i,
  /\brecommendation\s*rules\s*:/i,
  /\bcomplaint\s*context\b/i,
  /\blog\s*(?:the|this)\s*(?:request|note)\b/i,
];

const CONTENT_SECTION_HEADERS = new Set(['SERVICES', 'PRODUCTS', 'OFFERINGS', 'OPTIONS', 'PRICING']);

/** Leading ALL CAPS venue / title lines before real menu body (not section headers). */
function stripLeadingBrandCapsNoise(text: string): string {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (!line) {
      i++;
      continue;
    }
    const compact = line.replace(/\s+/g, ' ');
    const isAllCapsShort =
      line.length >= 3 &&
      line.length <= 56 &&
      line === line.toUpperCase() &&
      !/^[\d$€£,.:?\-–—]+$/u.test(line) &&
      !CONTENT_SECTION_HEADERS.has(compact);
    if (isAllCapsShort) {
      i++;
      continue;
    }
    break;
  }
  const remainder = lines.slice(i).join('\n').trimStart();
  if (remainder.length > 0) return remainder;

  const originalTrimmed = text.trim();
  if (!originalTrimmed) return '';

  // Leading venue-title stripping must not delete the entire outbound (e.g. short ALL-CAPS SMS replies).
  const isSingleLine = !originalTrimmed.includes('\n');
  if (isSingleLine && originalTrimmed.length <= 280) {
    return originalTrimmed;
  }

  return remainder;
}

/**
 * Remove internal-guidance paragraphs and noisy brand caps headers from raw KB text.
 */
export function stripInternalGuidanceFromText(text: string): string {
  let t = text.replace(/\r\n/g, '\n').trim();
  if (!t) return '';

  const paras = t.split(/\n{2,}/);
  const kept = paras.filter(p => {
    const s = p.trim();
    if (!s) return false;
    if (INTERNAL_GUIDANCE_LINE_PATTERNS.some(re => re.test(s))) return false;
    return true;
  });
  t = kept.join('\n\n').trim();

  const lines = t.split('\n');
  const lineKept = lines.filter(line => {
    const s = line.trim();
    if (!s) return true;
    return !INTERNAL_GUIDANCE_LINE_PATTERNS.some(re => re.test(s));
  });
  t = lineKept.join('\n').trim();

  t = stripLeadingBrandCapsNoise(t);
  return t.trim();
}

export function stripInternalGuidanceFromChunks(chunks: RetrievalChunk[]): RetrievalChunk[] {
  const out: RetrievalChunk[] = [];
  for (const c of chunks) {
    const content = stripInternalGuidanceFromText(c.content ?? '');
    if (!content) continue;
    out.push({
      ...c,
      content,
      metadata: {
        ...c.metadata,
        internalGuidanceStripped: true,
      },
    });
  }
  return out;
}
