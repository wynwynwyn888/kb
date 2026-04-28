/**
 * Generic keyword relevance for KB chunks (sections + titles). No domain-specific boosts.
 */

import { tokenizeMeaningful } from './kb-relevance';

/** Light query expansion (generic word-form variants, not domain topics). */
const TOKEN_ALIASES: ReadonlyArray<[string, string]> = [
  ['hour', 'hours'],
  ['menu', 'menus'],
  ['open', 'opening'],
  ['close', 'closing'],
  ['day', 'days'],
  ['book', 'booking'],
  ['price', 'pricing'],
  ['address', 'location'],
];

export function expandKbQueryTokens(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    if (t.length < 2) continue;
    out.add(t);
    for (const [a, b] of TOKEN_ALIASES) {
      if (t === a) out.add(b);
      if (t === b) out.add(a);
    }
  }
  return [...out];
}

export type ScorableChunk = {
  id: string;
  documentId: string;
  title: string;
  source: string;
  content: string;
  metadata: Record<string, unknown>;
};

function normWords(s: string): string {
  return s.toLowerCase().replace(/[^\w]+/g, '');
}

function tokenOverlapScore(queryTokens: string[], haystackNorm: string): number {
  let s = 0;
  for (const t of queryTokens) {
    if (t.length < 2) continue;
    if (haystackNorm.includes(t)) s += Math.min(12, t.length);
  }
  return s;
}

function intentVirtualTokens(intentHint?: string): string[] {
  if (!intentHint?.trim()) return [];
  return tokenizeMeaningful(intentHint.replace(/_/g, ' '));
}

/**
 * Score a single chunk for a query. Higher is better (unbounded raw); callers clamp when needed.
 */
export function scoreChunkForQuery(
  query: string,
  chunk: ScorableChunk,
  opts?: { intentHint?: string },
): number {
  const qRaw = query.trim();
  if (!qRaw) return 0;

  const queryTokens = tokenizeMeaningful(qRaw);
  const intentToks = intentVirtualTokens(opts?.intentHint);
  const allQueryToks = expandKbQueryTokens(
    [...new Set([...queryTokens, ...intentToks])].filter(t => t.length >= 2),
  );

  const contentNorm = normWords(chunk.content);
  const titleNorm = normWords(chunk.title);
  const sectionTitle =
    typeof chunk.metadata['sectionTitle'] === 'string' ? chunk.metadata['sectionTitle'].trim() : '';
  const sectionNorm = sectionTitle ? normWords(sectionTitle) : '';

  let score = 0;
  score += tokenOverlapScore(allQueryToks, contentNorm) * 1.0;
  score += tokenOverlapScore(allQueryToks, titleNorm) * 1.15;
  score += tokenOverlapScore(allQueryToks, sectionNorm) * 1.85;

  const qn = qRaw.toLowerCase();
  const lc = chunk.content.toLowerCase();
  const lt = chunk.title.toLowerCase();
  const ls = sectionTitle.toLowerCase();
  if (qn.length >= 3 && lc.includes(qn)) score += 2.4;
  if (qn.length >= 3 && lt.includes(qn)) score += 2.8;
  if (qn.length >= 3 && sectionTitle && ls.includes(qn)) score += 3.2;

  for (const t of allQueryToks) {
    if (t.length < 4) continue;
    if (sectionNorm.includes(t)) score += 0.55;
  }

  const du = chunk.metadata['documentUpdatedAt'];
  if (typeof du === 'string' && du.trim()) {
    const ms = Date.parse(du);
    if (!Number.isNaN(ms)) {
      const days = Math.max(0, (Date.now() - ms) / 86400000);
      score += 0.12 * Math.exp(-days / 45);
    }
  }

  const isIntro =
    chunk.metadata['chunkType'] === 'section' &&
    (chunk.metadata['sectionTitle'] == null || String(chunk.metadata['sectionTitle']).trim() === '');
  const substantive = queryTokens.filter(t => t.length >= 4).length;
  if (isIntro && sectionNorm.length === 0) {
    score -= substantive > 0 ? 0.85 : 0.35;
  }

  return score;
}

export function rankChunksByRelevance(
  query: string,
  chunks: ScorableChunk[],
  opts?: { intentHint?: string },
): Array<{ chunk: ScorableChunk; score: number }> {
  const q = query.trim();
  if (!q) {
    return chunks.map(c => ({ chunk: c, score: 0 }));
  }
  return chunks
    .map(chunk => ({ chunk, score: scoreChunkForQuery(q, chunk, opts) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Search UI: prefer strict positive matches; if none, return best-effort ranked chunks
 * (avoids empty results when chunks exist but lexical scores tie at zero).
 */
export function rankChunksForKbSearch(
  query: string,
  chunks: ScorableChunk[],
  opts: { intentHint?: string; topK: number },
): Array<{ chunk: ScorableChunk; score: number }> {
  const strict = rankChunksByRelevance(query, chunks, opts);
  if (strict.length > 0) return strict.slice(0, opts.topK);
  const q = query.trim();
  if (!q) return chunks.slice(0, opts.topK).map(c => ({ chunk: c, score: 0 }));
  return chunks
    .map(chunk => ({ chunk, score: scoreChunkForQuery(q, chunk, opts) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topK);
}

/**
 * Short snippet biased around the first strong query-token hit in content.
 * When `sectionTitle` matches the query (generic heading relevance), lead with it.
 */
export function buildSnippetAroundQuery(
  content: string,
  query: string,
  maxLen: number,
  sectionTitle?: string | null,
): string {
  const text = content.replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  const st = sectionTitle?.trim();
  if (st) {
    const stNorm = normWords(st);
    const qToks = expandKbQueryTokens(tokenizeMeaningful(query).filter(t => t.length >= 2));
    const titleHit = qToks.some(t => t.length >= 3 && stNorm.includes(t));
    if (titleHit) {
      const innerBudget = Math.max(80, maxLen - st.length - 4);
      const body = snippetBodyOnly(text, query, innerBudget);
      const combined = `${st} — ${body}`.trim();
      if (combined.length > maxLen) return `${combined.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
      return combined;
    }
  }

  if (text.length <= maxLen) return text;
  return snippetBodyOnly(text, query, maxLen);
}

function snippetBodyOnly(content: string, query: string, maxLen: number): string {
  const text = content.replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;

  const toks = expandKbQueryTokens(tokenizeMeaningful(query)).filter(t => t.length >= 3);
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of toks) {
    const j = lower.indexOf(t);
    if (j >= 0) {
      idx = j;
      break;
    }
  }
  if (idx < 0) {
    const j2 = lower.indexOf(query.trim().toLowerCase());
    idx = j2 >= 0 ? j2 : 0;
  }

  const half = Math.floor(maxLen / 2);
  const start = Math.max(0, Math.min(idx - half, text.length - maxLen));
  const slice = text.slice(start, start + maxLen).trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = start + maxLen < text.length ? '…' : '';
  return `${prefix}${slice}${suffix}`;
}
