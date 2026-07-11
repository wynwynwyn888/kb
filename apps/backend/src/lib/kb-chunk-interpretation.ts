/**
 * Classifies KB paragraphs for safe customer-facing use vs internal-only ops copy.
 * Mixed tenant notes are split so internal instructions never reach customer-facing KB injection.
 */

import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import { stripInternalGuidanceFromText } from './kb-internal-guidance';

export type KbSectionKind =
  | 'menu_data'
  | 'operating_hours'
  | 'address'
  | 'reservation_guidance'
  | 'special_request_internal'
  | 'complaint_flow_internal'
  | 'recommendation_style_internal'
  | 'business_profile'
  | 'unknown';

export type KbInterpretedSegment = {
  kind: KbSectionKind;
  text: string;
};

const INTERNAL_ONLY_KINDS: ReadonlySet<KbSectionKind> = new Set([
  'special_request_internal',
  'complaint_flow_internal',
  'recommendation_style_internal',
]);

export function classifyKbParagraph(raw: string): KbSectionKind {
  const s = raw.replace(/\r\n/g, '\n').trim();
  if (!s) return 'unknown';

  if (/\bspecial\s*request\s*:/i.test(s) || /\buse\s+this\s+exact\s+format\b/i.test(s)) {
    return 'special_request_internal';
  }
  if (/\blog\s*(?:the|this)\s*(?:request|note)\b/i.test(s) && /\b(?:internal|staff|team)\b/i.test(s)) {
    return 'special_request_internal';
  }
  if (/\bcomplaint\s*context\b/i.test(s) || /\bcomplaint\s+handling\b/i.test(s) || /\bservice\s+recovery\b/i.test(s)) {
    return 'complaint_flow_internal';
  }
  if (/\brecommendation\s*rules\s*:/i.test(s) || /\bkeep\s+suggestions\s+selective\b/i.test(s)) {
    return 'recommendation_style_internal';
  }
  if (/\b(?:internal|staff-only|for\s+staff)\b.*\b(?:format|template|script)\b/i.test(s)) {
    return 'special_request_internal';
  }

  if (
    /\b(?:open(?:ing)?|hours?|daily|every\s+day|including\s+public\s+holidays)\b/i.test(s) &&
    /\d/.test(s) &&
    /\d{1,2}(?:am|pm)\b|\d{1,2}\s*(?:am|pm)\b|\d{1,2}:\d{2}/i.test(s)
  ) {
    return 'operating_hours';
  }

  if (/\b\d{4,10}\b/.test(s) && /\b(?:ave|avenue|st\.?|street|road|drive|lane|boulevard|building)\b/i.test(s)) {
    return 'address';
  }

  if (/(?:[$€£]|\b[A-Z]{3}\s*)\d/.test(s) && /[A-H]\)|^\s*\d+\.\s/m.test(s)) {
    return 'menu_data';
  }

  if (/\b(?:book|reserve|reservation|walk-?in)\b/i.test(s)) {
    return 'reservation_guidance';
  }

  if (/^(?:about\s+us|our\s+story|we\s+are|welcome\s+to)\b/i.test(s)) {
    return 'business_profile';
  }

  return 'unknown';
}

export function segmentKbContent(content: string): KbInterpretedSegment[] {
  const t = content.replace(/\r\n/g, '\n').trim();
  if (!t) return [];

  const parts = t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return [];

  return parts.map(text => ({
    kind: classifyKbParagraph(text),
    text,
  }));
}

export function summarizeSegmentKinds(segments: KbInterpretedSegment[]): Record<KbSectionKind, number> {
  const counts = {} as Record<KbSectionKind, number>;
  const kinds: KbSectionKind[] = [
    'menu_data',
    'operating_hours',
    'address',
    'reservation_guidance',
    'special_request_internal',
    'complaint_flow_internal',
    'recommendation_style_internal',
    'business_profile',
    'unknown',
  ];
  for (const k of kinds) counts[k] = 0;
  for (const s of segments) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  return counts;
}

export function assembleCustomerFacingSegments(segments: KbInterpretedSegment[]): string {
  const kept = segments
    .filter(s => !INTERNAL_ONLY_KINDS.has(s.kind))
    .map(s => s.text.trim())
    .filter(Boolean);
  const joined = kept.join('\n\n').trim();
  return stripInternalGuidanceFromText(joined).trim();
}

/**
 * Rewrites each chunk to customer-safe KB text and records segment kind counts on metadata.
 */
export function interpretRetrievalChunks(chunks: RetrievalChunk[]): RetrievalChunk[] {
  return chunks
    .map(c => {
      const segments = segmentKbContent(c.content ?? '');
      const facing = assembleCustomerFacingSegments(segments);
      const fallback = stripInternalGuidanceFromText(c.content ?? '').trim();
      const contentOut = facing.length > 0 ? facing : fallback;
      return {
        ...c,
        content: contentOut,
        metadata: {
          ...c.metadata,
          kbSegmentKinds: summarizeSegmentKinds(segments),
          kbInterpreted: true,
        },
      };
    })
    .filter(c => (c.content ?? '').trim().length > 0);
}
