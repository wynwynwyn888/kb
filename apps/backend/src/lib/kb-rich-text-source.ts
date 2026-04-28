/**
 * Authoritative plain-text source for rich/manual KB notes lives in
 * `knowledge_documents.metadata[KB_RICH_TEXT_SOURCE_METADATA_KEY]` so the editor
 * never depends on lossy chunk round-trips. Chunks remain retrieval units only.
 */
export const KB_RICH_TEXT_SOURCE_METADATA_KEY = 'richTextContent';

export type ChunkRowForReconstruct = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  /** Prefer ingestion order when section metadata is missing or tied */
  createdAt?: string | null;
};

/**
 * Rebuild editable note text from chunk rows (migration / legacy fallback only).
 * Orders by sectionIndex, sectionPartIndex, createdAt, then id.
 */
export function reconstructEditableNoteFromChunks(rows: ReadonlyArray<ChunkRowForReconstruct>): string {
  const sorted = [...rows].sort((a, b) => {
    const ma = a.metadata;
    const mb = b.metadata;
    const ia = Number(ma['sectionIndex']);
    const ib = Number(mb['sectionIndex']);
    const pa = Number(ma['sectionPartIndex'] ?? 0);
    const pb = Number(mb['sectionPartIndex'] ?? 0);
    const na = Number.isFinite(ia) ? ia : 0;
    const nb = Number.isFinite(ib) ? ib : 0;
    if (na !== nb) return na - nb;
    if (pa !== pb) return pa - pb;
    const ta = a.createdAt ? Date.parse(String(a.createdAt)) : 0;
    const tb = b.createdAt ? Date.parse(String(b.createdAt)) : 0;
    if (ta !== tb && !Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  const parts = sorted.map(c => {
    const ma = c.metadata;
    const st = typeof ma['sectionTitle'] === 'string' ? String(ma['sectionTitle']).trim() : '';
    const partIdx = Number(ma['sectionPartIndex'] ?? 0);
    const text = (c.content ?? '').trim();
    if (st && text) {
      if (!Number.isFinite(partIdx) || partIdx === 0) return `${st}\n${text}`;
      return text;
    }
    return text;
  });

  return parts.filter(Boolean).join('\n\n').trim();
}
