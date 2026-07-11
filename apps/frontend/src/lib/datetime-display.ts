/**
 * Parse API timestamps into an instant (ms) regardless of minor format differences.
 * Avoids treating ambiguous strings as local wall time when they are meant as UTC.
 */

export const DEFAULT_DISPLAY_TIMEZONE =
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_APP_TIMEZONE']?.trim()) || 'UTC';

/**
 * Human-readable wall time in the configured app display timezone (UTC by default).
 * Example: "9 May 2026, 11:06 pm" — avoids raw ISO and browser-local ambiguity.
 */
export function formatDisplayDateTime(iso: string | null | undefined, timeZone: string = DEFAULT_DISPLAY_TIMEZONE): string {
  if (iso == null || typeof iso !== 'string') return '—';
  const t = parseApiInstantMs(iso);
  if (t == null) return '—';
  try {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return '—';
    const s = new Intl.DateTimeFormat('en-SG', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
    return s.replace(/\b(AM|PM)\b/g, m => m.toLowerCase());
  } catch {
    return '—';
  }
}

export function parseApiInstantMs(iso: string | null | undefined): number | null {
  if (iso == null || typeof iso !== 'string') return null;
  const s = iso.trim();
  if (!s) return null;
  const withT = s.includes('T') ? s : s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, '$1T$2');
  const naiveUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;
  if (naiveUtc.test(withT)) {
    const zMs = Date.parse(`${withT}Z`);
    if (!Number.isNaN(zMs)) return zMs;
  }
  let ms = Date.parse(withT);
  if (!Number.isNaN(ms)) return ms;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/.test(withT)) {
    ms = Date.parse(`${withT}Z`);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/**
 * Relative “updated” label; `nowMs` injectable for tests.
 * Long-range labels use `displayTimeZone` (IANA).
 */
export function relativeTimeLabel(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
  displayTimeZone: string = DEFAULT_DISPLAY_TIMEZONE,
): string {
  const t = parseApiInstantMs(iso);
  if (t == null) return '—';
  const sec = Math.floor((nowMs - t) / 1000);
  if (sec < 0) return 'just now';
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.max(1, Math.floor(sec / 3600))}h ago`;
  if (sec < 86400 * 14) return `${Math.max(1, Math.floor(sec / 86400))}d ago`;
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: displayTimeZone,
    month: 'short',
    day: 'numeric',
  }).format(new Date(t));
}
