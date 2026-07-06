// pgvector serialization helpers for the RAG shadow lane.
//
// PostgREST cannot reliably coerce a JavaScript number[] / JSON array into a
// Postgres `vector`. Vectors must cross the RPC boundary as a pgvector *text*
// literal (e.g. "[0.1,0.2,0.3]") and be cast to `vector` inside SQL.
//
// These helpers are pure and side-effect free. They are NOT wired into any
// runtime path in this change.

/** Expected embedding dimensionality for `text-embedding-3-small`. */
export const EMBEDDING_DIMENSIONS = 1536;

/** True when every element is a finite number and the array is non-empty. */
export function isValidEmbedding(vec: unknown): vec is number[] {
  if (!Array.isArray(vec) || vec.length === 0) return false;
  for (const v of vec) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  return true;
}

/**
 * Serialize a numeric embedding to a pgvector text literal: `[a,b,c]`.
 *
 * @throws if the vector is empty, contains non-finite values, or (when
 *         `expectedDimensions` is provided) has the wrong length.
 */
export function toPgVectorText(
  vec: number[],
  expectedDimensions?: number,
): string {
  if (!isValidEmbedding(vec)) {
    throw new Error('toPgVectorText: embedding must be a non-empty array of finite numbers');
  }
  if (expectedDimensions !== undefined && vec.length !== expectedDimensions) {
    throw new Error(
      `toPgVectorText: expected ${expectedDimensions} dimensions, got ${vec.length}`,
    );
  }
  return `[${vec.join(',')}]`;
}
