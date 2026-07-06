import { rrfMerge, compareRetrieval, RRF_K } from './kb-hybrid-merge';

const ids = (list: { chunkId: string }[]) => list.map(c => c.chunkId);

describe('kb-hybrid-merge', () => {
  describe('rrfMerge', () => {
    it('uses vector-only ranks when keyword is empty', () => {
      const merged = rrfMerge([{ chunkId: 'a' }, { chunkId: 'b' }], []);
      expect(ids(merged)).toEqual(['a', 'b']);
      expect(merged[0]!.vectorRank).toBe(1);
      expect(merged[0]!.keywordRank).toBeNull();
      expect(merged[0]!.rrfScore).toBeCloseTo(1 / (RRF_K + 1));
    });

    it('uses keyword-only ranks when vector is empty', () => {
      const merged = rrfMerge([], [{ chunkId: 'a' }, { chunkId: 'b' }]);
      expect(ids(merged)).toEqual(['a', 'b']);
      expect(merged[0]!.keywordRank).toBe(1);
      expect(merged[0]!.vectorRank).toBeNull();
    });

    it('fuses both paths and ranks shared chunks higher', () => {
      // "b" appears in both lists -> should outrank singletons.
      const vector = [{ chunkId: 'a' }, { chunkId: 'b' }];
      const keyword = [{ chunkId: 'b' }, { chunkId: 'c' }];
      const merged = rrfMerge(vector, keyword);
      expect(merged[0]!.chunkId).toBe('b');
      const b = merged.find(m => m.chunkId === 'b')!;
      expect(b.vectorRank).toBe(2);
      expect(b.keywordRank).toBe(1);
      expect(b.rrfScore).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1));
    });

    it('deduplicates duplicate chunk ids within a list (first occurrence wins)', () => {
      const merged = rrfMerge([{ chunkId: 'a' }, { chunkId: 'a' }], []);
      expect(merged.filter(m => m.chunkId === 'a')).toHaveLength(1);
      expect(merged[0]!.vectorRank).toBe(1);
    });

    it('is deterministic on ties (sorted by chunkId)', () => {
      const merged = rrfMerge([{ chunkId: 'y' }], [{ chunkId: 'x' }]);
      // Both have identical rrfScore (rank 1 in one path); tie-broken by id.
      expect(ids(merged)).toEqual(['x', 'y']);
    });
  });

  describe('compareRetrieval', () => {
    it('reports overlap, jaccard and top-chunk agreement', () => {
      const cmp = compareRetrieval(['a', 'b', 'c'], ['a', 'x']);
      expect(cmp.keywordCount).toBe(3);
      expect(cmp.vectorCount).toBe(2);
      expect(cmp.overlapCount).toBe(1);
      expect(cmp.jaccard).toBeCloseTo(1 / 4);
      expect(cmp.sameTopChunk).toBe(true);
      expect(cmp.keywordTopChunkId).toBe('a');
      expect(cmp.vectorTopChunkId).toBe('a');
      expect(cmp.vectorOnlyChunkIds).toEqual(['x']);
      expect(cmp.keywordOnlyChunkIds).toEqual(['b', 'c']);
    });

    it('handles both empty lists without dividing by zero', () => {
      const cmp = compareRetrieval([], []);
      expect(cmp.jaccard).toBe(0);
      expect(cmp.sameTopChunk).toBe(false);
      expect(cmp.keywordTopChunkId).toBeNull();
      expect(cmp.vectorTopChunkId).toBeNull();
    });

    it('detects disagreement on the top chunk', () => {
      const cmp = compareRetrieval(['a'], ['b']);
      expect(cmp.sameTopChunk).toBe(false);
      expect(cmp.overlapCount).toBe(0);
    });
  });
});
