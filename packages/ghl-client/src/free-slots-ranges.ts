/**
 * CRM-local wall-clock → UTC ms for GHL free-slots windows (IANA zones via Intl).
 * Duplicated from backend business-time so @aisbp/ghl-client stays self-contained.
 */

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
    const p = parts.find((x) => x.type === type);
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

function wallClockKey(w: { year: number; month: number; day: number; hour: number; minute: number }): number {
  return w.year * 1e10 + w.month * 1e8 + w.day * 1e6 + w.hour * 1e4 + w.minute;
}

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

export function snapUtcEpochMsToWholeSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

export function snapUtcEpochMsToWholeMinute(ms: number): number {
  return Math.floor(ms / 60000) * 60000;
}

export function parseYmdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

/** YYYY-MM-DD for an instant in an IANA zone (civil date). */
export function formatYmdInIanaZone(utcMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utcMs));
  const y = parts.find((p) => p.type === 'year')?.value;
  const mo = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !mo || !d) return '';
  return `${y}-${mo}-${d}`;
}

/** Inclusive UTC ms range for the full civil month containing `ymdStr` in `crmTz`. */
export function crmMonthStartEndMsInclusive(crmTz: string, ymdStr: string): { startMs: number; endMs: number } {
  const parts = parseYmdParts(ymdStr);
  if (!parts) throw new Error('Invalid YYYY-MM-DD');
  const { y, m } = parts;
  let startMs = wallClockInZoneToUtcMs(crmTz, y, m, 1, 0, 0);
  const nextMonthStart =
    m === 12
      ? wallClockInZoneToUtcMs(crmTz, y + 1, 1, 1, 0, 0)
      : wallClockInZoneToUtcMs(crmTz, y, m + 1, 1, 0, 0);
  const endMs = nextMonthStart - 1;
  startMs = snapUtcEpochMsToWholeSecond(startMs);
  return { startMs, endMs };
}

export function fullLocalDayRangeMs(crmTz: string, ymdStr: string): { startMs: number; endMs: number } {
  const p = parseYmdParts(ymdStr);
  if (!p) throw new Error('Invalid YYYY-MM-DD');
  let startMs = wallClockInZoneToUtcMs(crmTz, p.y, p.m, p.d, 0, 0);
  let endMs = startMs + 86400000 - 1;
  startMs = snapUtcEpochMsToWholeSecond(startMs);
  endMs = snapUtcEpochMsToWholeSecond(endMs);
  startMs = snapUtcEpochMsToWholeMinute(startMs);
  return { startMs, endMs };
}

/** From a local wall instant through end of that civil day in `crmTz`. */
export function selectedInstantToLocalDayEndRangeMs(
  crmTz: string,
  ymdStr: string,
  hour: number,
  minute: number,
): { startMs: number; endMs: number } {
  const p = parseYmdParts(ymdStr);
  if (!p) throw new Error('Invalid YYYY-MM-DD');
  let startMs = wallClockInZoneToUtcMs(crmTz, p.y, p.m, p.d, hour, minute);
  const dayStart = wallClockInZoneToUtcMs(crmTz, p.y, p.m, p.d, 0, 0);
  let endMs = dayStart + 86400000 - 1;
  startMs = snapUtcEpochMsToWholeSecond(startMs);
  endMs = snapUtcEpochMsToWholeSecond(endMs);
  startMs = snapUtcEpochMsToWholeMinute(startMs);
  return { startMs, endMs };
}

export function localTimePartsFromUtcMs(utcMs: number, crmTz: string): { ymd: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: crmTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { ymd: y && mo && d ? `${y}-${mo}-${d}` : '', hour, minute };
}

/**
 * HTTP query window for widget-backend free-slots (wide query), separate from the
 * caller's filter window [filterStartMs, filterEndMs].
 */
export function computeWidgetFreeSlotsQueryRange(
  rangeMode: 'month' | 'day' | 'selected_to_day_end',
  crmTz: string,
  filterStartMs: number,
): { queryStartMs: number; queryEndMs: number } {
  const ymd = formatYmdInIanaZone(filterStartMs, crmTz);
  if (rangeMode === 'month') {
    const { startMs, endMs } = crmMonthStartEndMsInclusive(crmTz, ymd);
    return { queryStartMs: startMs, queryEndMs: endMs };
  }
  if (rangeMode === 'day') {
    const { startMs, endMs } = fullLocalDayRangeMs(crmTz, ymd);
    return { queryStartMs: startMs, queryEndMs: endMs };
  }
  const { hour, minute } = localTimePartsFromUtcMs(filterStartMs, crmTz);
  const { startMs, endMs } = selectedInstantToLocalDayEndRangeMs(crmTz, ymd, hour, minute);
  return { queryStartMs: startMs, queryEndMs: endMs };
}

export function filterFreeSlotsToUtcWindow(
  slots: { startTime: string; endTime?: string }[],
  windowStartMs: number,
  windowEndMs: number,
): { startTime: string; endTime?: string }[] {
  return slots.filter((s) => {
    const t = Date.parse(s.startTime);
    if (Number.isNaN(t)) return false;
    return t >= windowStartMs && t <= windowEndMs;
  });
}
