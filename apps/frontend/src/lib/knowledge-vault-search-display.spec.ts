import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_SEARCH_VISIBLE_MIN_SCORE,
  filterKbSearchHitsForKnowledgeVaultUi,
  kbSearchHitMeetsKnowledgeVaultVisibleThreshold,
} from './knowledge-vault-search-display';
import type { KbSearchHit } from './api';

function hit(p: Partial<KbSearchHit> & Pick<KbSearchHit, 'chunkId'>): KbSearchHit {
  const { chunkId, relevanceLabel, scorePercent, score, ...rest } = p;
  return {
    documentId: 'd1',
    documentTitle: 'T',
    sectionTitle: null,
    snippet: '',
    score: score ?? 0.5,
    bestEffort: false,
    chunkId,
    kind: 'faq',
    updatedAt: null,
    relevanceLabel,
    scorePercent,
    ...rest,
  };
}

describe('knowledge-vault-search-display', () => {
  it('exports an obvious 0.8 threshold constant', () => {
    expect(KNOWLEDGE_SEARCH_VISIBLE_MIN_SCORE).toBe(0.8);
  });

  it('shows 98%, 84%, and exactly 80% when scorePercent is set', () => {
    expect(kbSearchHitMeetsKnowledgeVaultVisibleThreshold(hit({ chunkId: 'a', scorePercent: 98 }))).toBe(true);
    expect(kbSearchHitMeetsKnowledgeVaultVisibleThreshold(hit({ chunkId: 'b', scorePercent: 84 }))).toBe(true);
    expect(kbSearchHitMeetsKnowledgeVaultVisibleThreshold(hit({ chunkId: 'b2', scorePercent: 80 }))).toBe(true);
  });

  it('hides 79% even when relevanceLabel is HIGH', () => {
    expect(
      kbSearchHitMeetsKnowledgeVaultVisibleThreshold(
        hit({ chunkId: 'c', scorePercent: 79, relevanceLabel: 'MEDIUM' }),
      ),
    ).toBe(false);
    expect(
      kbSearchHitMeetsKnowledgeVaultVisibleThreshold(hit({ chunkId: 'd', scorePercent: 79, relevanceLabel: 'HIGH' })),
    ).toBe(false);
  });

  it('filters a mixed list: only rows at or above the strict threshold', () => {
    const out = filterKbSearchHitsForKnowledgeVaultUi([
      hit({ chunkId: '1', scorePercent: 25, relevanceLabel: 'BEST_EFFORT' }),
      hit({ chunkId: '2', scorePercent: 84, relevanceLabel: 'MEDIUM' }),
      hit({ chunkId: '3', scorePercent: 70, relevanceLabel: 'HIGH' }),
    ]);
    expect(out.map(h => h.chunkId)).toEqual(['2']);
  });

  it('falls back to normalized score when scorePercent missing', () => {
    expect(
      kbSearchHitMeetsKnowledgeVaultVisibleThreshold(
        hit({ chunkId: 'e', scorePercent: undefined, score: 0.85, relevanceLabel: 'LOW' }),
      ),
    ).toBe(true);
    expect(
      kbSearchHitMeetsKnowledgeVaultVisibleThreshold(
        hit({ chunkId: 'f', scorePercent: undefined, score: 0.79, relevanceLabel: 'LOW' }),
      ),
    ).toBe(false);
    expect(
      kbSearchHitMeetsKnowledgeVaultVisibleThreshold(
        hit({ chunkId: 'g', scorePercent: undefined, score: 0.8, relevanceLabel: 'HIGH' }),
      ),
    ).toBe(true);
  });
});
