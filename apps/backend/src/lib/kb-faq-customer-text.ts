/**
 * Deterministic, conservative polish for KB/FAQ snippets when LLM generation is unavailable.
 * Must not invent facts — only rephrase structure that is clearly hours-style or trivial joins.
 */

const WEEKDAY_LINE =
  /^\s*(weekdays?|mon-?fri|monday\s*[-–]\s*friday)\s*[:\s/-]*\s*(.+?)\s*$/i;
const WEEKEND_LINE =
  /^\s*(weekends?|sat-?sun|saturday\s*[,/&]\s*sunday)\s*[:\s/-]*\s*(.+?)\s*$/i;

/** "9am-11pm", "9:00 AM - 11 PM", "9am to 11pm" → kept as-is inside sentence */
function normalizeTimeSpan(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * If text looks like weekday/weekend hour lines, return a single natural English sentence.
 * Otherwise return null (caller keeps original snippet).
 */
export function tryPolishOpeningHoursLines(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  const lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    // Single line might be "Weekdays 9am-11pm / Weekends 9am-12am"
    const slash = raw.split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
    if (slash.length === 2) {
      const a = slash[0]!.match(WEEKDAY_LINE);
      const b = slash[1]!.match(WEEKEND_LINE);
      if (a && b) {
        const wd = normalizeTimeSpan(a[2]!);
        const we = normalizeTimeSpan(b[2]!);
        return `We're open from ${wd} on weekdays, and ${we} on weekends.`;
      }
    }
    return null;
  }

  let weekdaySpan: string | null = null;
  let weekendSpan: string | null = null;
  for (const line of lines) {
    const wm = line.match(WEEKDAY_LINE);
    if (wm) {
      weekdaySpan = normalizeTimeSpan(wm[2]!);
      continue;
    }
    const em = line.match(WEEKEND_LINE);
    if (em) {
      weekendSpan = normalizeTimeSpan(em[2]!);
      continue;
    }
  }

  if (weekdaySpan && weekendSpan) {
    return `We're open from ${weekdaySpan} on weekdays, and ${weekendSpan} on weekends.`;
  }
  return null;
}

/**
 * Polish KB snippet for placeholder / deterministic outbound path only.
 */
export function polishKbSnippetForCustomer(raw: string): string {
  const t = raw.trim();
  if (!t) return t;

  const hours = tryPolishOpeningHoursLines(t);
  if (hours) return hours;

  return t;
}
