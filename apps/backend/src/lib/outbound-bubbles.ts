/**
 * Packs plain text into 1–3 outbound bubbles for SMS/WhatsApp.
 * Used by ReplyPlannerService (orchestration → queue → GHL).
 */

import { prepareCustomerFacingPlainTextForOutboundSplit } from './customer-facing-live-format';

const ONE_BUBBLE_UNDER = 500;
const BUBBLE_PACK_TARGET = 520;
const MAX_OUTBOUND_BUBBLES = 3;
const HARD_BUBBLE_CAP = 3600;

/** @deprecated Prefer `prepareCustomerFacingPlainTextForOutboundSplit` — kept for existing imports/tests. */
export const normalizeShortMultilineBody = prepareCustomerFacingPlainTextForOutboundSplit;

function chunkByChar(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxChars).trim());
    i += maxChars;
  }
  return chunks.filter(c => c.length > 0);
}

function splitOnSentenceBoundary(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [];
  if (sentences.length === 0) {
    return chunkByChar(text, maxChars);
  }

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).trim().length <= maxChars) {
      current += sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current.trim()) {
    const remaining = current.trim();
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
    } else {
      chunks.push(...chunkByChar(remaining, maxChars));
    }
  }

  return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
}

function splitLongParagraph(para: string, maxChars: number): string[] {
  if (para.length <= maxChars) return [para];
  return splitOnSentenceBoundary(para, maxChars);
}

function mergeDownToMaxBubbles(parts: string[], maxBubbles: number): string[] {
  if (parts.length <= maxBubbles) return parts;
  const out = [...parts];
  while (out.length > maxBubbles) {
    const last = out.pop()!;
    const prev = out.pop()!;
    out.push(`${prev}\n\n${last}`);
  }
  return out;
}

/**
 * Greedy-pack sections into bubbles ≤ BUBBLE_PACK_TARGET; at most MAX_OUTBOUND_BUBBLES.
 */
export function packPlainTextIntoOutboundBubbles(text: string): Array<{ index: number; text: string }> {
  const body = prepareCustomerFacingPlainTextForOutboundSplit(text);
  if (!body) return [];

  if (body.length <= ONE_BUBBLE_UNDER) {
    return [{ index: 0, text: body }];
  }

  let sections = body
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sections.length === 0) return [];

  sections = sections.flatMap(s =>
    s.length > BUBBLE_PACK_TARGET ? splitLongParagraph(s, BUBBLE_PACK_TARGET) : [s],
  );

  const packed: string[] = [];
  let current = '';

  for (const seg of sections) {
    const merged = current ? `${current}\n\n${seg}` : seg;
    if (merged.length <= BUBBLE_PACK_TARGET || current === '') {
      current = merged;
    } else {
      packed.push(current);
      current = seg;
    }
  }
  if (current) packed.push(current);

  let bubbles = mergeDownToMaxBubbles(packed, MAX_OUTBOUND_BUBBLES);

  bubbles = bubbles.flatMap(b =>
    b.length > HARD_BUBBLE_CAP ? splitLongParagraph(b, HARD_BUBBLE_CAP) : [b],
  );
  bubbles = mergeDownToMaxBubbles(bubbles, MAX_OUTBOUND_BUBBLES);

  return bubbles.map((t, i) => ({ index: i, text: t }));
}
