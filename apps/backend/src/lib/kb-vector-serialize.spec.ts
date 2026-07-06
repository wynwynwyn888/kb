import { toPgVectorText, isValidEmbedding, EMBEDDING_DIMENSIONS } from './kb-vector-serialize';

describe('kb-vector-serialize', () => {
  describe('isValidEmbedding', () => {
    it('accepts a non-empty finite numeric array', () => {
      expect(isValidEmbedding([0.1, -0.2, 3])).toBe(true);
    });

    it('rejects empty arrays', () => {
      expect(isValidEmbedding([])).toBe(false);
    });

    it('rejects non-arrays and non-finite values', () => {
      expect(isValidEmbedding(null)).toBe(false);
      expect(isValidEmbedding('[]')).toBe(false);
      expect(isValidEmbedding([1, NaN])).toBe(false);
      expect(isValidEmbedding([1, Infinity])).toBe(false);
      expect(isValidEmbedding([1, '2' as unknown as number])).toBe(false);
    });
  });

  describe('toPgVectorText', () => {
    it('serializes to a pgvector bracket string', () => {
      expect(toPgVectorText([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
    });

    it('preserves negatives and integers', () => {
      expect(toPgVectorText([-1, 0, 2.5])).toBe('[-1,0,2.5]');
    });

    it('throws on empty or invalid input', () => {
      expect(() => toPgVectorText([])).toThrow();
      expect(() => toPgVectorText([1, NaN])).toThrow();
    });

    it('enforces expected dimensions when provided', () => {
      expect(() => toPgVectorText([1, 2, 3], 4)).toThrow(/expected 4 dimensions/);
      expect(toPgVectorText([1, 2, 3], 3)).toBe('[1,2,3]');
    });

    it('exposes the model dimensionality constant', () => {
      expect(EMBEDDING_DIMENSIONS).toBe(1536);
    });
  });
});
