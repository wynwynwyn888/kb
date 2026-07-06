// Embedding input preparation + stable content hashing for the RAG shadow lane.
//
// The exact text that is sent to the embedding provider is also the text that
// is hashed. Hashing the *prepared* input (not the raw content) guarantees the
// worker and the DB write path agree on `embedding_input_hash` without any
// SQL-side rehashing, which is what the stale-embedding guard relies on.
//
// Pure helpers, not wired into any runtime path in this change.

import { createHash } from 'node:crypto';

/** Hard cap on characters sent to the embedding API. */
export const MAX_EMBEDDING_INPUT_CHARS = 8000;

/** Ellipsis suffix appended to truncated input. */
const TRUNCATION_SUFFIX = '...';

/**
 * Prepare chunk/query text for embedding. If the input exceeds
 * {@link MAX_EMBEDDING_INPUT_CHARS}, it is truncated so the result (including
 * the `...` suffix) never exceeds the cap.
 */
export function prepareEmbeddingInput(text: string): string {
  const s = text ?? '';
  if (s.length <= MAX_EMBEDDING_INPUT_CHARS) return s;
  const keep = MAX_EMBEDDING_INPUT_CHARS - TRUNCATION_SUFFIX.length;
  return s.slice(0, keep) + TRUNCATION_SUFFIX;
}

/**
 * Stable SHA-256 (hex) of the given text. Callers should hash the *prepared*
 * embedding input so the hash matches what was actually embedded.
 */
export function embeddingInputHash(preparedInput: string): string {
  return createHash('sha256').update(preparedInput, 'utf8').digest('hex');
}

/**
 * Convenience: prepare input and compute its hash together, guaranteeing the
 * hash corresponds exactly to the text that will be embedded.
 */
export function prepareEmbeddingInputWithHash(text: string): {
  input: string;
  hash: string;
} {
  const input = prepareEmbeddingInput(text);
  return { input, hash: embeddingInputHash(input) };
}
