import type { KbSearchHit } from '@/lib/api';

/** Normalized 0–1 minimum relevance for vault search UI (maps to ≥80% when using `scorePercent`). */
export const KNOWLEDGE_SEARCH_VISIBLE_MIN_SCORE = 0.8;

const MIN_PERCENT = KNOWLEDGE_SEARCH_VISIBLE_MIN_SCORE * 100;

/**
 * Tenant Knowledge Vault search UI: strict floor at 80% (or normalized score ≥ 0.8 when percent absent).
 * When `scorePercent` is present, it is authoritative (a 79% row is hidden even if `relevanceLabel` is HIGH).
 */
export function kbSearchHitMeetsKnowledgeVaultVisibleThreshold(
  hit: Pick<KbSearchHit, 'scorePercent' | 'score'>,
): boolean {
  if (typeof hit.scorePercent === 'number' && Number.isFinite(hit.scorePercent)) {
    return hit.scorePercent >= MIN_PERCENT;
  }
  if (typeof hit.score === 'number' && Number.isFinite(hit.score)) {
    return hit.score >= KNOWLEDGE_SEARCH_VISIBLE_MIN_SCORE;
  }
  return false;
}

export function filterKbSearchHitsForKnowledgeVaultUi(hits: KbSearchHit[]): KbSearchHit[] {
  return hits.filter(kbSearchHitMeetsKnowledgeVaultVisibleThreshold);
}
