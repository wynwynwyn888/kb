import {
  PSEUDO_EMBED_DIMS,
  cosineSimilarity,
  hasPseudoCompatibleEmbedding,
  pseudoEmbedFromText,
} from './kb-vector-score';

describe('kb-vector-score', () => {
  it('hasPseudoCompatibleEmbedding accepts pseudo-dim vectors only', () => {
    expect(hasPseudoCompatibleEmbedding({ embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.1) })).toBe(true);
    expect(hasPseudoCompatibleEmbedding({ embedding: new Array(1536).fill(0.1) })).toBe(false);
    expect(hasPseudoCompatibleEmbedding({})).toBe(false);
  });

  it('pseudoEmbedFromText produces normalized vectors of expected size', () => {
    const vec = pseudoEmbedFromText('appointment booking hours');
    expect(vec).toHaveLength(PSEUDO_EMBED_DIMS);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('cosineSimilarity returns 0 on dimension mismatch', () => {
    const a = pseudoEmbedFromText('hello');
    const b = new Array(1536).fill(0.01);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});
