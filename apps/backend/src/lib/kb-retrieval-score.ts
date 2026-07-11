/**
 * Generic keyword relevance for KB chunks (sections + titles).
 * No business-specific topics — uses universal intent synonyms (hour/menu/address/price/booking/complaint).
 */

import { tokenizeMeaningful } from './kb-relevance';
import { expandKbQueryWithIntent, isFocusedEntityServiceQuery } from './kb-intent-synonyms';
import type { KbSearchRelevanceLabel } from '../modules/kb/dto/retrieval.dto';

/** Section titles that usually describe post-care, not the service itself. */
const AFTERCARE_SECTION_TITLE =
  /aftercare|after\s+care|post[- ]?(?:purchase|service)|care\s+guide|aftercare\s+guide|what\s+to\s+expect|following\s+service|aftercare\s+guidance/i;

/** Word-form variants kept as legacy export for callers that care about plural forms only. */
const TOKEN_ALIASES: ReadonlyArray<[string, string]> = [
  ['hour', 'hours'],
  ['menu', 'menus'],
  ['open', 'opening'],
  ['close', 'closing'],
  ['day', 'days'],
  ['book', 'booking'],
  ['price', 'pricing'],
  ['address', 'location'],
  ['service', 'services'],
  ['offering', 'offerings'],
  ['product', 'products'],
  ['package', 'packages'],
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

/**
 * Generic heading "strength" for ranking: formal ALL-CAPS blocks score higher than
 * sentence-like helper headings ("The business offers…", "After your purchase…").
 */
export function sectionHeadingStrength(sectionTitle: string | null | undefined): number {
  if (!sectionTitle?.trim()) return 1;
  const t = sectionTitle.trim();
  if (/^(the|for|if|after|when|then|because|while|although)\s+/i.test(t)) return 0.52;
  if (t.includes('.') || t.split(',').length > 3) return 0.58;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 14) return 0.62;
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return 0.8;
  const lower = (t.match(/\p{Ll}/gu) ?? []).length;
  const upper = (t.match(/\p{Lu}/gu) ?? []).length;
  if (lower === 0 && upper / letters.length >= 0.65) return 1;
  return 0.78;
}

function looksLikeServiceCatalogSectionTitle(st: string): boolean {
  const s = st.toLowerCase();
  return (
    /\b(services|menu|price\s*list|catalog|offerings?|products?|packages?)\b/.test(
      s,
    ) || /\bservice\s+menu\b/.test(s)
  );
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
  const expanded = expandKbQueryWithIntent(qRaw, opts?.intentHint);

  const sectionTitle =
    typeof chunk.metadata['sectionTitle'] === 'string' ? chunk.metadata['sectionTitle'].trim() : '';
  const sectionNorm = sectionTitle ? normWords(sectionTitle) : '';
  const sectionTitleLc = sectionTitle.toLowerCase();
  const hStrength = sectionHeadingStrength(sectionTitle);
  const isFocusedEntity = isFocusedEntityServiceQuery(qRaw);

  const allQueryToks = expandKbQueryTokens(
    [...new Set([...queryTokens, ...intentToks, ...expanded.tokens])].filter(t => t.length >= 2),
  );

  const contentNorm = normWords(chunk.content);
  const titleNorm = normWords(chunk.title);

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
  if (qn.length >= 3 && sectionTitle && ls.includes(qn)) score += 8.0;

  for (const t of allQueryToks) {
    if (t.length < 4) continue;
    if (sectionNorm.includes(t)) score += 0.55;
  }

  // Intent-driven section heading boost — broad "menu/services" queries prefer catalog headings.
  if (sectionTitleLc) {
    if (expanded.broadMenuListingQuery) {
      let primaryHit = false;
      for (const hint of expanded.menuListingPrimaryHints) {
        if (!hint) continue;
        if (sectionTitleLc.includes(hint)) {
          score += 20 * hStrength;
          primaryHit = true;
          break;
        }
      }
      if (!primaryHit) {
        for (const hint of expanded.menuListingSecondaryHints) {
          if (!hint) continue;
          if (sectionTitleLc.includes(hint)) score += 2.6 * hStrength;
        }
      }
      if (
        /\bservices\b/i.test(sectionTitleLc) &&
        !sectionTitleLc.includes('service menu') &&
        !/\bprice\s*list\b/i.test(sectionTitleLc)
      ) {
        /* Softer penalty: generic "Services" headings often hold the full catalog. */
        score -= 2.25 * (2 - hStrength);
      }
    } else {
      for (const hint of expanded.sectionTitleHints) {
        if (!hint) continue;
        if (sectionTitleLc.includes(hint)) {
          score += 4.5 * hStrength;
          break;
        }
      }
    }
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
    score -= substantive > 0 ? 1.4 : 0.35;
  }

  // Service detail vs aftercare: named-item queries should not land on post-care sections first.
  if (isFocusedEntity && !expanded.aftercareIntent) {
    if (sectionTitle && AFTERCARE_SECTION_TITLE.test(sectionTitle)) {
      score -= 14;
    }
    const lead = chunk.content.trim().slice(0, 220).toLowerCase();
    if (qn.length >= 4 && /^after\s+/.test(lead) && lead.includes(qn) && sectionTitle && AFTERCARE_SECTION_TITLE.test(sectionTitle)) {
      score -= 8;
    }
    if (/\b(from\s*[\$£€¥]|from\s+\d+|\$\s*\d|[A-Z]{3}\s*\d|£\s*\d|€\s*\d|\bfrom\s*\$)/i.test(chunk.content)) {
      score += 5.5;
    }
    if (sectionTitle && looksLikeServiceCatalogSectionTitle(sectionTitle) && !AFTERCARE_SECTION_TITLE.test(sectionTitle)) {
      score += 3.2;
    }
  }

  if (expanded.aftercareIntent && sectionTitle && AFTERCARE_SECTION_TITLE.test(sectionTitle)) {
    score += 12;
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
 *
 * Returns raw scores; UI normalizes with `normalizeForDisplay`.
 */
export function rankChunksForKbSearch(
  query: string,
  chunks: ScorableChunk[],
  opts: { intentHint?: string; topK: number },
): Array<{ chunk: ScorableChunk; score: number; bestEffort?: boolean }> {
  const strict = rankChunksByRelevance(query, chunks, opts);
  if (strict.length > 0) return strict.slice(0, opts.topK);
  const q = query.trim();
  if (!q) return chunks.slice(0, opts.topK).map(c => ({ chunk: c, score: 0, bestEffort: true }));
  return chunks
    .map(chunk => ({ chunk, score: scoreChunkForQuery(q, chunk, opts), bestEffort: true }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topK);
}

/**
 * Normalize search scores for UI display.
 * - For the strong leader, returns a high (≤1) score.
 * - For best-effort hits with raw score ≤ 0, caps display at 0.2 — never shows 100% on a bad match.
 */
export function normalizeKbSearchScores(
  raw: Array<{ chunk: ScorableChunk; score: number; bestEffort?: boolean }>,
): Array<{ chunk: ScorableChunk; score: number; bestEffort: boolean }> {
  if (raw.length === 0) return [];
  const max = raw[0]!.score;
  const norm = max > 0 ? max : 1;
  return raw.map(r => {
    const isBestEffort = Boolean(r.bestEffort) || r.score <= 0;
    if (isBestEffort) {
      return { chunk: r.chunk, score: Math.min(0.2, Math.max(0, r.score / norm)), bestEffort: true };
    }
    return { chunk: r.chunk, score: Math.min(1, Math.max(0, r.score / norm)), bestEffort: false };
  });
}

/**
 * Map normalized rank scores + chunk/query signals into UI-friendly labels and 0–100 percentages.
 * Avoids showing "100%" unless there is a strong lexical or intent-to-heading match.
 */
export function computeKbSearchHitPresentation(opts: {
  query: string;
  chunk: ScorableChunk;
  normalizedScore: number;
  bestEffort: boolean;
}): { relevanceLabel: KbSearchRelevanceLabel; scorePercent: number; bestEffort: boolean } {
  const { query, chunk, normalizedScore, bestEffort } = opts;
  if (bestEffort) {
    return {
      relevanceLabel: 'BEST_EFFORT',
      scorePercent: Math.min(28, Math.round(5 + Math.max(0, normalizedScore) * 23)),
      bestEffort: true,
    };
  }

  const expanded = expandKbQueryWithIntent(query);
  const qn = query.trim().toLowerCase();
  const rawQ = query.trim();
  const st =
    typeof chunk.metadata['sectionTitle'] === 'string' ? chunk.metadata['sectionTitle'].trim() : '';
  const stl = st.toLowerCase();
  const lc = chunk.content.toLowerCase();
  const strength = sectionHeadingStrength(st);

  const exactPhraseInTitle = qn.length >= 3 && Boolean(st) && stl.includes(qn);
  const exactPhraseInContent = qn.length >= 3 && lc.includes(qn);
  const wordCount = rawQ.split(/\s+/).filter(Boolean).length;

  let intentMatchesHeading = false;
  if (stl) {
    for (const hint of expanded.sectionTitleHints) {
      if (hint && stl.includes(hint)) {
        intentMatchesHeading = true;
        break;
      }
    }
  }

  const strongIntentToHeading = intentMatchesHeading && strength >= 0.85;

  const qualifiesHigh =
    exactPhraseInTitle ||
    (exactPhraseInContent && (qn.length >= 5 || wordCount <= 3)) ||
    strongIntentToHeading;

  let tier: KbSearchRelevanceLabel;
  if (qualifiesHigh) tier = 'HIGH';
  else if (intentMatchesHeading || normalizedScore >= 0.66) tier = 'MEDIUM';
  else if (normalizedScore >= 0.38) tier = 'LOW';
  else tier = 'LOW';

  let scorePercent: number;
  if (tier === 'HIGH') {
    const allow100 = exactPhraseInTitle || strongIntentToHeading || (exactPhraseInContent && qn.length >= 6);
    const v = Math.round(70 + normalizedScore * 28);
    scorePercent = allow100 ? Math.min(100, Math.max(82, v)) : Math.min(92, Math.max(68, v));
  } else if (tier === 'MEDIUM') {
    scorePercent = Math.min(86, Math.round(34 + normalizedScore * 52));
  } else {
    scorePercent = Math.min(58, Math.round(14 + normalizedScore * 42));
  }

  return { relevanceLabel: tier, scorePercent, bestEffort: false };
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
    const expanded = expandKbQueryWithIntent(query);
    const qToks = expandKbQueryTokens(
      [...new Set([...tokenizeMeaningful(query), ...expanded.tokens])].filter(t => t.length >= 2),
    );
    const titleHit =
      qToks.some(t => t.length >= 3 && stNorm.includes(t)) ||
      expanded.sectionTitleHints.some(h => h && st.toLowerCase().includes(h));
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

  const expanded = expandKbQueryWithIntent(query);
  const toks = expandKbQueryTokens(
    [...new Set([...tokenizeMeaningful(query), ...expanded.tokens])],
  ).filter(t => t.length >= 3);
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
