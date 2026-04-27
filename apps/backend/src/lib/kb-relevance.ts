/**
 * KB relevance for the **latest** user message only (not conversation-wide).
 * Blocks obvious mismatches (e.g. menu question vs opening-hours FAQ).
 */

import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';

/** Tokens ignored for overlap / Jaccard (prevents "your" matching every FAQ title). */
export const KB_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'by',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'your',
  'our',
  'we',
  'they',
  'them',
  'their',
  'me',
  'my',
  'mine',
  'us',
  'ur',
  'u',
  'im',
  'ive',
  'dont',
  'cant',
  'wont',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'where',
  'why',
  'how',
  'when',
  'do',
  'does',
  'did',
  'doing',
  'done',
  'have',
  'has',
  'had',
  'having',
  'get',
  'got',
  'please',
  'thanks',
  'thank',
  'hello',
  'hi',
  'hey',
  'yes',
  'no',
  'ok',
  'okay',
  'just',
  'really',
  'very',
  'some',
  'any',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'such',
  'than',
  'too',
  'so',
  'can',
  'could',
  'would',
  'should',
  'may',
  'might',
  'must',
  'will',
  'shall',
  'about',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'up',
  'down',
  'out',
  'off',
  'over',
  'again',
  'then',
  'once',
  'here',
  'there',
  'tell',
  'mean',
  'like',
  'want',
  'need',
  'know',
  'see',
  'come',
  'go',
  'give',
  'make',
  'take',
  'got',
]);

const MENU_QUERY = /\b(menu|menus|food|foods|eat|eating|drink|drinks|starter|starters|main|mains|dessert|desserts|vegan|vegetarian|dish|dishes|kitchen|lunch|dinner|breakfast|order|ordering|wtf|buffet)\b/i;
const HOURS_QUERY =
  /\b(hour|hours|opening|open|close|closing|closed|time|times|when|weekday|weekdays|weekend|weekends|schedule|today|tomorrow|am|pm)\b/i;

const HOURS_KB = /\b(hour|hours|opening|open|close|closing|weekday|weekends?|weekdays?|am|pm|schedule)\b/i;
const MENU_KB = /\b(menu|menus|food|drink|starter|starters|main|mains|dessert|desserts|vegan|vegetarian|dish|dishes|kitchen|buffet|course)\b/i;

export function tokenizeMeaningful(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^\w]/g, ''))
    .filter(t => t.length >= 2 && !KB_STOPWORDS.has(t));
}

export function classifyQueryForKbLog(q: string): 'menu' | 'hours' | 'mixed' | 'other' {
  const m = MENU_QUERY.test(q);
  const h = HOURS_QUERY.test(q);
  if (m && h) return 'mixed';
  if (m) return 'menu';
  if (h) return 'hours';
  return 'other';
}

export function querySuggestsMenuOnly(q: string): boolean {
  return MENU_QUERY.test(q) && !HOURS_QUERY.test(q);
}

export function querySuggestsHoursOnly(q: string): boolean {
  return HOURS_QUERY.test(q) && !MENU_QUERY.test(q);
}

function chunkCorpus(c: RetrievalChunk): string {
  const meta = c.metadata;
  const qMeta =
    meta && typeof meta['question'] === 'string' ? String(meta['question']) : '';
  return `${c.title} ${qMeta} ${c.content}`.toLowerCase();
}

function chunkLooksHoursFocused(c: RetrievalChunk): boolean {
  return HOURS_KB.test(chunkCorpus(c));
}

function chunkLooksMenuFocused(c: RetrievalChunk): boolean {
  return MENU_KB.test(chunkCorpus(c));
}

export function kbTitleShortForLog(c: RetrievalChunk): string {
  const t = (c.title || 'untitled').slice(0, 72).replace(/\s+/g, ' ').trim();
  return t || 'untitled';
}

export type KbRejectionLogEntry = {
  reason: string;
  queryClass: ReturnType<typeof classifyQueryForKbLog>;
  kbTitleShort: string;
};

/**
 * Returns chunks that pass relevance vs latest user message (order preserved).
 */
export function filterKbChunksForLatestUserMessage(
  latestUserMessage: string,
  chunks: RetrievalChunk[],
): { chunks: RetrievalChunk[]; rejections: KbRejectionLogEntry[] } {
  const q = latestUserMessage.trim();
  const rejections: KbRejectionLogEntry[] = [];
  const kept: RetrievalChunk[] = [];

  for (const c of chunks) {
    const r = assessKbChunkRelevance(q, c);
    if (r.ok) {
      kept.push(c);
    } else if (r.reason) {
      rejections.push({
        reason: r.reason,
        queryClass: classifyQueryForKbLog(q),
        kbTitleShort: kbTitleShortForLog(c),
      });
    }
  }

  return { chunks: kept, rejections };
}

function assessKbChunkRelevance(
  latestUserMessage: string,
  chunk: RetrievalChunk,
): { ok: boolean; reason?: string } {
  const q = latestUserMessage.trim();
  if (!q) {
    return { ok: false, reason: 'empty_latest_message' };
  }

  const corpus = chunkCorpus(chunk);
  const qTokens = new Set(tokenizeMeaningful(q));
  const corpusTokens = new Set(tokenizeMeaningful(corpus));

  if (querySuggestsMenuOnly(q) && chunkLooksHoursFocused(chunk) && !chunkLooksMenuFocused(chunk)) {
    return { ok: false, reason: 'intent_mismatch_menu_vs_hours_kb' };
  }

  if (querySuggestsHoursOnly(q) && chunkLooksMenuFocused(chunk) && !chunkLooksHoursFocused(chunk)) {
    return { ok: false, reason: 'intent_mismatch_hours_vs_menu_kb' };
  }

  if (querySuggestsHoursOnly(q) && chunkLooksHoursFocused(chunk)) {
    return { ok: true };
  }

  const expandedCorpus = new Set(corpusTokens);
  for (const t of corpusTokens) {
    if (t === 'opening' || t === 'opened') expandedCorpus.add('open');
    if (t === 'open') expandedCorpus.add('opening');
    if (t === 'hour') expandedCorpus.add('hours');
    if (t === 'hours') expandedCorpus.add('hour');
  }
  const overlap = [...qTokens].filter(t => expandedCorpus.has(t));
  if (overlap.length > 0) {
    return { ok: true };
  }

  const qLower = q.toLowerCase();
  if (qLower.length >= 4 && corpus.includes(qLower)) {
    return { ok: true };
  }

  return { ok: false, reason: 'no_meaningful_overlap' };
}

export function detectMenuIntentInMessage(text: string): boolean {
  return MENU_QUERY.test(text.trim());
}
