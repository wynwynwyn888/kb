/**
 * Detects conflicting operating-hours statements across KB chunks and keeps the highest-priority source.
 */

import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import { segmentKbContent, type KbInterpretedSegment } from './kb-chunk-interpretation';

/** Collapse whitespace and case for comparing hour statements. */
export function normalizeHoursSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
}

function chunkPriorityMs(chunk: RetrievalChunk): number {
  const m = chunk.metadata ?? {};
  const u =
    (typeof m['documentUpdatedAt'] === 'string' && m['documentUpdatedAt']) ||
    (typeof m['document_updated_at'] === 'string' && m['document_updated_at']) ||
    (typeof m['updated_at'] === 'string' && m['updated_at']) ||
    (typeof m['updatedAt'] === 'string' && m['updatedAt']) ||
    '';
  if (u) {
    const t = Date.parse(u);
    if (Number.isFinite(t)) return t;
  }
  return Math.round((chunk.relevanceScore ?? 0) * 1e12);
}

function extractOperatingHoursSegments(content: string): KbInterpretedSegment[] {
  return segmentKbContent(content).filter(s => s.kind === 'operating_hours');
}

/**
 * Returns merged hours text per chunk and unique normalized signatures (for conflict detection).
 */
export function collectOperatingHoursFromChunks(chunks: RetrievalChunk[]): {
  signatures: string[];
  byChunk: Array<{ chunkId: string; hoursText: string; signature: string; priorityMs: number }>;
} {
  const byChunk: Array<{ chunkId: string; hoursText: string; signature: string; priorityMs: number }> = [];
  const signatures: string[] = [];

  for (const c of chunks) {
    const segs = extractOperatingHoursSegments(c.content ?? '');
    if (segs.length === 0) continue;
    const hoursText = segs.map(s => s.text.trim()).join('\n\n').trim();
    const sig = normalizeHoursSignature(hoursText);
    if (sig.length < 8) continue;
    byChunk.push({
      chunkId: c.chunkId,
      hoursText,
      signature: sig,
      priorityMs: chunkPriorityMs(c),
    });
    signatures.push(sig);
  }

  return { signatures, byChunk };
}

export function operatingHoursConflictDetected(signatures: string[]): boolean {
  const uniq = new Set(signatures.map(normalizeHoursSignature).filter(s => s.length >= 8));
  return uniq.size >= 2;
}

/**
 * When multiple chunks disagree on hours, strip hours paragraphs from lower-priority chunks
 * so downstream layers see a single canonical source (newest / highest score).
 */
export function resolveOperatingHoursConflictsAmongChunks(
  chunks: RetrievalChunk[],
  log: (msg: string) => void,
): RetrievalChunk[] {
  const { signatures, byChunk } = collectOperatingHoursFromChunks(chunks);
  if (byChunk.length < 2 || !operatingHoursConflictDetected(signatures)) {
    return chunks;
  }

  log('KB conflict detected: operating_hours');

  const winner = [...byChunk].sort((a, b) => b.priorityMs - a.priorityMs)[0]!;
  const hourLineRe =
    /\b(?:open(?:ing)?|hours?|daily|every\s+day|including\s+public\s+holidays|am|pm)\b/i;

  return chunks.map(c => {
    if (c.chunkId === winner.chunkId) {
      return {
        ...c,
        metadata: {
          ...c.metadata,
          kbOperatingHoursCanonical: true,
        },
      };
    }
    const segs = segmentKbContent(c.content ?? '');
    const stripped = segs
      .filter(s => s.kind !== 'operating_hours')
      .map(s => s.text)
      .join('\n\n')
      .trim();

    let content = stripped;
    if (!content.trim() && hourLineRe.test(c.content ?? '')) {
      content = (c.content ?? '')
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(p => !hourLineRe.test(p) || !/\d/.test(p))
        .join('\n\n')
        .trim();
    }

    return {
      ...c,
      content: content.trim(),
      metadata: {
        ...c.metadata,
        kbOperatingHoursStrippedDueToConflict: true,
      },
    };
  }).filter(c => (c.content ?? '').trim().length > 0);
}
