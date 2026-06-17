/** Normalize GHL `GET /calendars/events` responses to a list of event start times. */

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function readStartIso(row: Record<string, unknown>): string | null {
  const candidates = ['startTime', 'start_time', 'start', 'startDate'];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function parseGhlCalendarEventsResponse(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter(isRecord)
      .map(readStartIso)
      .filter((s): s is string => Boolean(s));
  }
  if (!isRecord(raw)) return [];
  const nested =
    raw['events'] ??
    raw['appointments'] ??
    raw['data'] ??
    raw['items'] ??
    raw['calendarEvents'];
  if (Array.isArray(nested)) {
    return nested
      .filter(isRecord)
      .map(readStartIso)
      .filter((s): s is string => Boolean(s));
  }
  if (isRecord(nested) && Array.isArray(nested['events'])) {
    return nested['events']
      .filter(isRecord)
      .map(readStartIso)
      .filter((s): s is string => Boolean(s));
  }
  return [];
}

/** Compare two ISO instants at minute precision (CRM slot buckets). */
export function sameMinuteIso(a: string, b: string): boolean {
  const am = Date.parse(a);
  const bm = Date.parse(b);
  if (!Number.isFinite(am) || !Number.isFinite(bm)) return a.trim() === b.trim();
  return Math.floor(am / 60_000) === Math.floor(bm / 60_000);
}

export function countEventsMatchingSlotStart(eventStarts: string[], slotStartIso: string): number {
  let count = 0;
  for (const start of eventStarts) {
    if (sameMinuteIso(start, slotStartIso)) count++;
  }
  return count;
}
