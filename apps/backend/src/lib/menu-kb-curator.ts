/**
 * Curates menu KB into short customer-facing excerpts for the model (not raw dumps).
 */

import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import { stripInternalGuidanceFromText } from './kb-internal-guidance';

export type MenuSectionHint = 'starters' | 'mains' | 'desserts' | 'vegan' | 'general';

const SECTION_ALIASES: Record<MenuSectionHint, RegExp[]> = {
  starters: [/\bSTARTERS?\b/i, /\bSTARTER\b/i],
  mains: [/\bMAINS?\b/i, /\bMAIN COURSE\b/i],
  desserts: [/\bDESSERTS?\b/i],
  vegan: [/\bVEGAN\b/i, /\bPLANT-?BASED\b/i],
  general: [],
};

export function userRequestsFullMenu(userMessage: string): boolean {
  return /\b(full|entire|complete|whole|all)\s+(?:the\s+)?menu\b/i.test(userMessage.trim());
}

export function inferMenuSectionHint(
  userMessage: string,
  menuAnchorLabel: string | undefined,
): MenuSectionHint {
  const t = userMessage.toLowerCase();
  if (menuAnchorLabel) {
    const a = menuAnchorLabel.toLowerCase();
    if (a.includes('starter')) return 'starters';
    if (a.includes('main')) return 'mains';
    if (a.includes('dessert')) return 'desserts';
    if (a.includes('vegan')) return 'vegan';
  }
  if (/\bvegan|plant\s*based\b/i.test(t)) return 'vegan';
  if (/\bstarter\b|\bstarters\b/i.test(t)) return 'starters';
  if (/\bdessert\b|\bdesserts\b/i.test(t)) return 'desserts';
  if (/\bmain\b|\bmains\b/i.test(t)) return 'mains';
  return 'general';
}

function findSectionStartIndex(text: string, section: MenuSectionHint): number {
  if (section === 'general') {
    const m = text.search(/\bRESTAURANT MENU\b/i);
    if (m >= 0) return m;
    for (const s of ['STARTERS', 'MAINS', 'DESSERTS', 'VEGAN'] as const) {
      const re = new RegExp(`^${s}\\b`, 'im');
      const hit = text.search(re);
      if (hit >= 0) return hit;
    }
    return 0;
  }
  let best = -1;
  for (const re of SECTION_ALIASES[section]) {
    const hit = text.search(re);
    if (hit >= 0 && (best < 0 || hit < best)) best = hit;
  }
  return best >= 0 ? best : 0;
}

function findNextSectionIndex(text: string, from: number): number {
  const tail = text.slice(from + 1);
  const re = /\n(?=(?:STARTERS?|MAINS?|DESSERTS?|VEGAN|DRINKS|BEVERAGES|SIDES|RESTAURANT MENU)\b)/i;
  const m = tail.match(re);
  if (!m || m.index == null) return text.length;
  return from + 1 + m.index;
}

const ITEM_LINE =
  /^(?:[A-D]\)\s*.+|\d+\.\s+.+|[-•*]\s*.+|.+?\b(?:\$|SGD|EUR|USD)\s*\d|\d{1,3}\s*(?:g|ml|mins?)\b.*)/i;

function isLikelyItemLine(line: string): boolean {
  const s = line.trim();
  if (s.length < 8) return false;
  if (s === s.toUpperCase() && s.length < 55) return false;
  return ITEM_LINE.test(s) || /^[A-D]\)\s*\S/.test(s);
}

/**
 * Extract up to `maxItems` menu item blocks (item line + optional short continuation).
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
    // absorb one continuation line if it looks like description (not a new item)
    if (i < lines.length) {
      const next = lines[i]!.trim();
      if (
        next &&
        !isLikelyItemLine(next) &&
        next.length <= 160 &&
        !/^(?:STARTERS?|MAINS?|DESSERTS?|VEGAN)\b/i.test(next)
      ) {
        block += `\n   ${next}`;
        i++;
      }
    }
    blocks.push(block);
  }
  return blocks;
}

export function curateMenuDocumentForCustomer(params: {
  mergedKbText: string;
  sectionHint: MenuSectionHint;
  maxItems: number;
  generalPreamble: boolean;
}): string {
  const base = stripInternalGuidanceFromText(params.mergedKbText);
  if (!base) return '';

  const start = findSectionStartIndex(base, params.sectionHint);
  let end = base.length;
  if (params.sectionHint !== 'general') {
    end = findNextSectionIndex(base, start);
  }
  let slice = base.slice(start, end).trim();
  if (!slice) slice = base.trim();

  const blocks = extractMenuItemBlocks(slice, params.maxItems);
  if (blocks.length === 0) {
    const cap = slice.length > 1600 ? `${slice.slice(0, 1600).trim()}…` : slice;
    if (params.generalPreamble && params.sectionHint === 'general') {
      return `Sure — our menu includes starters, mains, desserts, and vegan options.\n\n${cap}`;
    }
    if (params.sectionHint !== 'general') {
      return '';
    }
    return cap;
  }

  const numbered = blocks.map((b, idx) => {
    const [first, ...rest] = b.split('\n');
    const head = `${idx + 1}. ${first!.trim()}`;
    const tail = rest.map(l => `   ${l.trim()}`).join('\n');
    return tail ? `${head}\n${tail}` : head;
  });

  if (params.generalPreamble && params.sectionHint === 'general') {
    return (
      'Sure — our menu includes starters, mains, desserts, and vegan options.\n\n' +
      'Here are a few highlights:\n\n' +
      numbered.join('\n\n')
    );
  }

  return numbered.join('\n\n');
}

export type PrepareMenuKbParams = {
  latestUserMessage: string;
  latestIntent: ConversationIntent;
  /** From orchestration when resolving A/B/C/D to a category label */
  menuAnchorLabel?: string;
};

/**
 * Returns a single synthetic chunk with curated menu text for the LLM, or [] if nothing usable.
 */
export function prepareCustomerFacingMenuKb(
  chunks: RetrievalChunk[],
  params: PrepareMenuKbParams,
): RetrievalChunk[] {
  if (chunks.length === 0) return [];
  const merged = chunks.map(c => (c.content ?? '').trim()).filter(Boolean).join('\n\n');
  const sectionHint = inferMenuSectionHint(params.latestUserMessage, params.menuAnchorLabel);
  const full = userRequestsFullMenu(params.latestUserMessage);
  const maxItems = full ? 12 : 4;
  const generalPreamble = sectionHint === 'general' && params.latestIntent === 'MENU';

  const curated = curateMenuDocumentForCustomer({
    mergedKbText: merged,
    sectionHint,
    maxItems,
    generalPreamble,
  });
  if (!curated.trim()) return [];

  const top = chunks[0]!;
  return [
    {
      chunkId: `curated-menu-${top.chunkId}`,
      documentId: top.documentId,
      title: 'Menu highlights',
      content: curated,
      source: top.source ?? 'kb_curated',
      relevanceScore: top.relevanceScore,
      metadata: {
        ...top.metadata,
        menuCurated: true,
        menuSectionHint: sectionHint,
      },
    },
  ];
}

export function shouldCurateMenuKbContext(params: {
  latestIntent: ConversationIntent;
  menuKbAnchor?: string;
}): boolean {
  if (params.latestIntent === 'MENU') return true;
  if (params.latestIntent === 'SHORT_SELECTION' && params.menuKbAnchor?.trim()) return true;
  return false;
}
