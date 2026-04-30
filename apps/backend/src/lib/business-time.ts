/**
 * Business-local wall clock and greeting period (IANA zones via Intl).
 * Greeting periods match Singapore-facing defaults; tenant override can pass a different zone.
 */

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export interface BusinessLocalSnapshot {
  isoUtc: string;
  /** Civil local datetime in `timeZone` (no offset suffix). */
  localIso: string;
  timeZone: string;
  hour: number;
  minute: number;
  dayPeriod: DayPeriod;
  greetingLabel: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function wallClockInZone(at: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const n = (type: Intl.DateTimeFormatPartTypes) => {
    const p = parts.find(x => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    hour: n('hour'),
    minute: n('minute'),
  };
}

/** Singapore-style day parts: morning 05–11, afternoon 12–17, evening otherwise (including 00–04). */
export function getDayPeriodFromLocalHour(hour: number): DayPeriod {
  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 17) return 'afternoon';
  return 'evening';
}

export function greetingLabelForPeriod(period: DayPeriod): string {
  switch (period) {
    case 'morning':
      return 'Good morning';
    case 'afternoon':
      return 'Good afternoon';
    case 'evening':
      return 'Good evening';
  }
}

export function getBusinessLocalNow(timeZone: string, at: Date = new Date()): BusinessLocalSnapshot {
  const { year, month, day, hour, minute } = wallClockInZone(at, timeZone);
  const dayPeriod = getDayPeriodFromLocalHour(hour);
  return {
    isoUtc: at.toISOString(),
    localIso: `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00`,
    timeZone,
    hour,
    minute,
    dayPeriod,
    greetingLabel: greetingLabelForPeriod(dayPeriod),
  };
}

/**
 * Resolved IANA zone for the app process (no side effects).
 * Order: APP_TIMEZONE → TZ → Asia/Singapore.
 */
export function resolveAppTimeZone(): string {
  const fromApp = process.env['APP_TIMEZONE']?.trim();
  if (fromApp) return fromApp;
  const fromTz = process.env['TZ']?.trim();
  if (fromTz) return fromTz;
  return 'Asia/Singapore';
}

/** Sets `process.env["TZ"]` so Node logs and default locale behavior align with the resolved zone. */
export function resolveAndApplyProcessTimeZone(): string {
  const tz = resolveAppTimeZone();
  process.env['TZ'] = tz;
  return tz;
}

function wallClockKey(w: { year: number; month: number; day: number; hour: number; minute: number }): number {
  return w.year * 1e10 + w.month * 1e8 + w.day * 1e6 + w.hour * 1e4 + w.minute;
}

/**
 * Maps a civil wall-clock time in an IANA zone to a UTC epoch ms instant (GHL free-slots expects ms).
 * Falls back to `Date.UTC` if no instant in a ±48h window matches (DST gap / search edge case).
 */
export function wallClockInZoneToUtcMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const target = wallClockKey({ year, month, day, hour, minute });
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let lo = naive - 48 * 3600 * 1000;
  let hi = naive + 48 * 3600 * 1000;
  let best = naive;
  let found = false;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const w = wallClockInZone(new Date(mid), timeZone);
    const k = wallClockKey(w);
    if (k === target) {
      found = true;
      best = mid;
      break;
    }
    if (k < target) lo = mid + 1;
    else hi = mid - 1;
  }
  if (found) return best;
  return naive;
}
