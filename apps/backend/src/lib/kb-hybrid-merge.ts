// Reciprocal Rank Fusion (RRF) merge + keyword-vs-vector comparison helpers
// for the RAG shadow lane.
//
// These are pure, log-only analysis helpers. They do NOT influence customer
// replies and are not wired into the live retrieval path in this change.

/** Standard RRF dampening constant. */
export const RRF_K = 60;

export interface RankedCandidate {
  chunkId: string;
  /** Raw path score (vector similarity or keyword score); for debug only. */
  score?: number;
}

export interface RrfMergedCandidate {
  chunkId: string;
  rrfScore: number;
  /** 1-based rank in the vector list, or null if absent. */
  vectorRank: number | null;
  /** 1-based rank in the keyword list, or null if absent. */
  keywordRank: number | null;
  vectorScore: number | null;
  keywordScore: number | null;
}

function toRankMap(
  candidates: RankedCandidate[],
): Map<string, { rank: number; score: number | null }> {
  const map = new Map<string, { rank: number; score: number | null }>();
  candidates.forEach((c, i) => {
    // First occurrence wins (input is assumed pre-sorted best-first).
    if (!map.has(c.chunkId)) {
      map.set(c.chunkId, { rank: i + 1, score: c.score ?? null });
    }
  });
  return map;
}

/**
 * Merge vector and keyword candidate lists with Reciprocal Rank Fusion.
 * Inputs are assumed sorted best-first. Output is deduplicated by chunkId and
 * sorted by descending RRF score (ties broken by chunkId for determinism).
 */
export function rrfMerge(
  vector: RankedCandidate[],
  keyword: RankedCandidate[],
  k: number = RRF_K,
): RrfMergedCandidate[] {
  const vectorRanks = toRankMap(vector);
  const keywordRanks = toRankMap(keyword);

  const allIds = new Set<string>([...vectorRanks.keys(), ...keywordRanks.keys()]);
  const merged: RrfMergedCandidate[] = [];

  for (const chunkId of allIds) {
    const v = vectorRanks.get(chunkId) ?? null;
    const kw = keywordRanks.get(chunkId) ?? null;
    const rrfScore =
      (v ? 1 / (k + v.rank) : 0) + (kw ? 1 / (k + kw.rank) : 0);
    merged.push({
      chunkId,
      rrfScore,
      vectorRank: v?.rank ?? null,
      keywordRank: kw?.rank ?? null,
      vectorScore: v?.score ?? null,
      keywordScore: kw?.score ?? null,
    });
  }

  merged.sort((a, b) =>
    b.rrfScore !== a.rrfScore ? b.rrfScore - a.rrfScore : a.chunkId.localeCompare(b.chunkId),
  );
  return merged;
}

export interface RetrievalComparison {
  keywordCount: number;
  vectorCount: number;
  /** Chunk IDs present in both lists. */
  overlapCount: number;
  /** |intersection| / |union| over chunk IDs (0 when both empty). */
  jaccard: number;
  /** True when the top result of each path is the same chunk. */
  sameTopChunk: boolean;
  keywordTopChunkId: string | null;
  vectorTopChunkId: string | null;
  /** Vector chunk IDs the keyword path did not surface at all. */
  vectorOnlyChunkIds: string[];
  /** Keyword chunk IDs the vector path did not surface at all. */
  keywordOnlyChunkIds: string[];
}

/**
 * Compute log-only comparison metrics between the keyword result the reply used
 * and the shadow vector result. Order-preserving for the *-only lists.
 */
export function compareRetrieval(
  keywordIds: string[],
  vectorIds: string[],
): RetrievalComparison {
  const kwSet = new Set(keywordIds);
  const vSet = new Set(vectorIds);

  let overlapCount = 0;
  for (const id of vSet) if (kwSet.has(id)) overlapCount++;

  const unionSize = new Set([...keywordIds, ...vectorIds]).size;
  const jaccard = unionSize === 0 ? 0 : overlapCount / unionSize;

  const keywordTopChunkId = keywordIds[0] ?? null;
  const vectorTopChunkId = vectorIds[0] ?? null;

  return {
    keywordCount: keywordIds.length,
    vectorCount: vectorIds.length,
    overlapCount,
    jaccard,
    sameTopChunk:
      keywordTopChunkId !== null && keywordTopChunkId === vectorTopChunkId,
    keywordTopChunkId,
    vectorTopChunkId,
    vectorOnlyChunkIds: vectorIds.filter(id => !kwSet.has(id)),
    keywordOnlyChunkIds: keywordIds.filter(id => !vSet.has(id)),
  };
}
