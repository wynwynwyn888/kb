/**
 * Best-effort extraction of a concrete calendar slot range from KB chunk text.
 * Used by AiRouterService when booking intent is detected (structured hint for planners / BOOK_SLOT).
 */

export type KbSlotChunkInput = {
  content: string;
  metadata?: Record<string, unknown>;
};

export type ExtractedKbSlot = {
  startTime: string;
  endTime: string;
  calendarId: string;
  source: 'KB';
  timezone?: string;
};

// "2026-05-01T10:00 - 2026-05-01T10:30" or with :00 seconds
const RANGE_RE =
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)\s*-\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/;

const DATE_ONLY_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

function normalizeCalendarId(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  const raw = meta['calendarId'];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Walk KB chunks in order; return the first chunk that yields a parseable slot.
 */
export function extractSlotFromKb(kbContext: KbSlotChunkInput[]): ExtractedKbSlot | undefined {
  if (!Array.isArray(kbContext) || kbContext.length === 0) return undefined;

  for (const chunk of kbContext) {
    const text = typeof chunk.content === 'string' ? chunk.content : '';
    if (!text.trim()) continue;

    const range = text.match(RANGE_RE);
    if (range) {
      const startTime = range[1]!;
      const endTime = range[2]!;
      return {
        startTime,
        endTime,
        calendarId: normalizeCalendarId(chunk.metadata),
        source: 'KB',
        timezone: undefined,
      };
    }

    const day = text.match(DATE_ONLY_RE);
    if (day) {
      const d = day[1]!;
      return {
        startTime: `${d}T09:00:00`,
        endTime: `${d}T09:30:00`,
        calendarId: normalizeCalendarId(chunk.metadata),
        source: 'KB',
        timezone: undefined,
      };
    }
  }

  return undefined;
}
