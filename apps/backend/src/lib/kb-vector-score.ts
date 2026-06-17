/** Cosine similarity for embedding vectors stored in chunk metadata (pgvector-ready). */

export function readEmbeddingVector(meta: Record<string, unknown> | undefined): number[] | null {
  if (!meta) return null;
  const raw = meta['embedding'];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const vec: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    vec.push(v);
  }
  return vec.length > 0 ? vec : null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Lightweight bag-of-words fallback when query embedding is unavailable. */
export function pseudoEmbedFromText(text: string, dims = 64): number[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const vec = new Array<number>(dims).fill(0);
  for (const t of tokens) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    vec[h % dims]! += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm <= 0) return vec;
  return vec.map(v => v / norm);
}
