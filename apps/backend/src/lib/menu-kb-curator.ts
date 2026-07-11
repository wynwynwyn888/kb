/**
 * Universal "menu / services / products" KB curator.
 *
 * Goals:
 * - Never hardcode industry categories.
 * - When the user picked an option, prefer chunks whose `sectionTitle`
 *   matches that label and slice their content to a short customer-facing excerpt.
 * - When no anchor is given, return the original chunks unchanged — section-aware retrieval has
 *   already done the right thing.
 */

import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import { stripInternalGuidanceFromText } from './kb-internal-guidance';

export function userRequestsFullMenu(userMessage: string): boolean {
  return /\b(full|entire|complete|whole|all)\s+(?:the\s+)?(menu|services|products|catalog(?:ue)?|offerings?)\b/i.test(
    userMessage.trim(),
  );
}

const ITEM_LINE =
  /^(?:[A-D]\)\s*.+|\d+\.\s+.+|[-•*]\s*.+|.+?\b(?:\$|RM|SGD|EUR|USD|GBP)\s*\d|\d{1,3}\s*(?:g|ml|mins?)\b.*)/i;

function isLikelyItemLine(line: string): boolean {
  const s = line.trim();
  if (s.length < 8) return false;
  if (s === s.toUpperCase() && s.length < 55) return false;
  return ITEM_LINE.test(s) || /^[A-D]\)\s*\S/.test(s);
}

/**
 * Extract up to `maxItems` item blocks (item line + optional short continuation).
 */
export function extractMenuItemBlocks(sectionText: string, maxItems: number): string[] {
  const lines = sectionText.split('\n').map(l => l.trimEnd());
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length && blocks.length < maxItems) {
    const line = lines[i]!.trim();
    if (!line) {
      i++;
      continue;
    }
    if (!isLikelyItemLine(line)) {
      i++;
      continue;
    }
    let block = line;
    i++;
    if (i < lines.length) {
      const next = lines[i]!.trim();
      if (next && !isLikelyItemLine(next) && next.length <= 160) {
        block += `\n   ${next}`;
        i++;
      }
    }
    blocks.push(block);
  }
  return blocks;
}

/**
 * Find the slice of merged KB text that corresponds to the given section label, generically.
 *
 * - Looks for a heading line that contains all of the label's significant tokens, regardless of
 *   case ("PREMIUM SUPPORT" matches "Premium", "ADDRESS" matches "address", etc.).
 * - If found, slice up to the next ALL-CAPS heading line (or 1.6kB cap).
 * - If not found, returns null.
 */
export function findSectionSliceByLabel(
  mergedText: string,
  label: string,
): { start: number; end: number } | null {
  const tokens = label
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length >= 3);
  if (tokens.length === 0) return null;

  const lines = mergedText.split('\n');
  let charIdx = 0;
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lower = line.toLowerCase();
    const isHeading =
      line.trim().length > 0 &&
      (line.trim() === line.trim().toUpperCase() || /^#{1,6}\s+/.test(line));
    if (isHeading && tokens.every(t => lower.includes(t))) {
      startLine = i;
      break;
    }
    charIdx += line.length + 1; // +1 for "\n"
  }
  if (startLine < 0) return null;

  // Find the next heading line after startLine.
  let end = mergedText.length;
  let cIdx = charIdx + lines[startLine]!.length + 1;
  for (let j = startLine + 1; j < lines.length; j++) {
    const line = lines[j]!;
    const isHeading =
      line.trim().length > 4 &&
      ((line.trim() === line.trim().toUpperCase() && /[A-Z]/.test(line)) ||
        /^#{1,6}\s+/.test(line));
    if (isHeading) {
      end = cIdx;
      break;
    }
    cIdx += line.length + 1;
  }
  return { start: charIdx, end };
}

export type PrepareMenuKbParams = {
  latestUserMessage: string;
  latestIntent: ConversationIntent;
  /** From orchestration when resolving A/B/C/D to a section label (any vertical). */
  menuAnchorLabel?: string;
};

/**
 * Curated chunks for menu/services flows. Universal:
 *
 * - With anchor → slice by section label and emit one curated synthetic chunk.
 * - Without anchor → pass chunks through unchanged.
 */
export function prepareCustomerFacingMenuKb(
  chunks: RetrievalChunk[],
  params: PrepareMenuKbParams,
): RetrievalChunk[] {
  if (chunks.length === 0) return [];

  const anchor = params.menuAnchorLabel?.trim();
  if (!anchor) {
    // No section to slice for — let section-aware retrieval results pass through.
    return chunks;
  }

  // Try to find a chunk whose own sectionTitle matches the anchor first (cleanest path).
  const tokens = anchor.toLowerCase().split(/\W+/).filter(t => t.length >= 3);
  const anchored = chunks.find(c => {
    const st = c.metadata?.['sectionTitle'];
    if (typeof st !== 'string') return false;
    const lower = st.toLowerCase();
    return tokens.length > 0 && tokens.every(t => lower.includes(t));
  });

  if (anchored) {
    const cleaned = stripInternalGuidanceFromText(anchored.content ?? '');
    if (!cleaned) return chunks;
    return [
      {
        ...anchored,
        chunkId: `curated-${anchored.chunkId}`,
        title: anchored.title,
        content: cleaned.slice(0, 1600),
        metadata: {
          ...anchored.metadata,
          menuCurated: true,
          menuAnchorLabel: anchor,
        },
      },
    ];
  }

  // Fallback: search the merged content for a heading line matching the anchor tokens.
  const merged = chunks.map(c => (c.content ?? '').trim()).filter(Boolean).join('\n\n');
  const cleaned = stripInternalGuidanceFromText(merged);
  if (!cleaned) return chunks;

  const slice = findSectionSliceByLabel(cleaned, anchor);
  if (!slice) {
    // No matching section — return original chunks instead of inventing categories.
    return chunks;
  }

  const text = cleaned.slice(slice.start, slice.end).trim();
  if (!text) return chunks;

  const top = chunks[0]!;
  return [
    {
      chunkId: `curated-${top.chunkId}`,
      documentId: top.documentId,
      title: anchor,
      content: text.slice(0, 1600),
      source: top.source ?? 'kb_curated',
      relevanceScore: top.relevanceScore,
      metadata: {
        ...top.metadata,
        menuCurated: true,
        menuAnchorLabel: anchor,
      },
    },
  ];
}

export function shouldCurateMenuKbContext(params: {
  latestIntent: ConversationIntent;
  menuKbAnchor?: string;
}): boolean {
  // Only curate when we have a concrete anchor (a resolved selection). For plain MENU we just let
  // section-aware retrieval results flow through unchanged.
  return params.latestIntent === 'SHORT_SELECTION' && Boolean(params.menuKbAnchor?.trim());
}
