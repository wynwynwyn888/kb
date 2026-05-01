/**
 * Lightweight booking intent + field extraction for conversation booking automation.
 * Avoids over-triggering on generic price questions without booking language.
 */

const BOOKING_LEX = new RegExp(
  [
    '\\bbook(ing)?\\b',
    '\\bappointment\\b',
    '\\bschedule\\b',
    '\\bslot\\b',
    '\\bavailable\\b',
    '\\breserve\\b',
    '\\breservation\\b',
    '\\bcome\\s+in\\b',
    '\\bvisit\\b',
    '\\bsee\\s+you\\b',
  ].join('|'),
  'i',
);

const PRICE_ONLY = /\b(how\s+much|price|cost|pricing|rate|charge)\b/i;

const YMD = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(\+?\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/;

/** Relative day words resolved using "today" reference in tenant-local YYYY-MM-DD. */
export function detectLiveBookingInterest(combinedText: string): boolean {
  const t = combinedText.trim();
  if (!t || t.length < 4) return false;
  if (!BOOKING_LEX.test(t)) return false;
  if (PRICE_ONLY.test(t) && !/\b(book|appointment|slot|schedule|reserve|visit)\b/i.test(t)) {
    return false;
  }
  return true;
}

export function resolveRelativeDayPhrase(text: string, todayYmd: string): string | undefined {
  const t = text.toLowerCase();
  const base = parseYmd(todayYmd);
  if (!base) return undefined;
  const addDays = (n: number): string | undefined => {
    const dt = new Date(Date.UTC(base!.y, base!.m - 1, base!.d + n));
    return formatYmd(dt);
  };
  if (/\btoday\b/.test(t)) return todayYmd;
  if (/\btomorrow\b/.test(t)) return addDays(1);
  const dow = [
    { re: /\bmonday\b/, d: 1 },
    { re: /\btuesday\b/, d: 2 },
    { re: /\bwednesday\b/, d: 3 },
    { re: /\bthursday\b/, d: 4 },
    { re: /\bfriday\b/, d: 5 },
    { re: /\bsaturday\b/, d: 6 },
    { re: /\bsunday\b/, d: 0 },
  ] as const;
  const ref = new Date(Date.UTC(base.y, base.m - 1, base.d));
  const curDow = ref.getUTCDay();
  for (const { re, d } of dow) {
    if (re.test(t)) {
      let delta = (d - curDow + 7) % 7;
      if (delta === 0) delta = 7;
      return addDays(delta);
    }
  }
  const m = YMD.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function formatYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function extractEmail(text: string): string | undefined {
  const m = text.match(EMAIL);
  return m ? m[0]!.trim() : undefined;
}

export function extractPhone(text: string): string | undefined {
  const m = text.match(PHONE);
  return m ? m[0]!.replace(/\s+/g, ' ').trim() : undefined;
}

/** HH:MM 24h or 3pm / 3:30pm */
export function extractPreferredTime(text: string): string | undefined {
  const t = text.trim();
  const m24 = /\b(\d{1,2}):(\d{2})\b/.exec(t);
  if (m24) {
    const h = Math.min(23, parseInt(m24[1]!, 10));
    const mm = Math.min(59, parseInt(m24[2]!, 10));
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const m12 = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t);
  if (m12) {
    let h = parseInt(m12[1]!, 10);
    const mm = m12[2] ? parseInt(m12[2], 10) : 0;
    const ap = m12[3]!.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return undefined;
}

export function extractServiceGuess(text: string): string | undefined {
  const t = text.trim();
  const m = /\b(book|schedule|appointment)\s+(?:for\s+)?(?:a\s+)?([a-z0-9][a-z0-9\s&'-]{2,40})/i.exec(t);
  if (m && m[2]) return m[2]!.trim();
  return undefined;
}

export function extractNameGuess(text: string): string | undefined {
  const m = /\b(?:i'?m|i am|name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/.exec(text);
  if (m) return m[1]!.trim();
  return undefined;
}

export function extractFirstVisit(text: string): string | undefined {
  if (/\bfirst\s+(visit|time)\b/i.test(text)) return 'yes';
  if (/\b(returning|been\s+before|regular)\b/i.test(text)) return 'no';
  return undefined;
}

export type SlotSelectionParse =
  | { kind: 'option'; option: number }
  | { kind: 'time'; normalizedHm: string }
  | { kind: 'unclear' };

/** Map user reply to offered slot index (1-based) or time match. */
export function parseSlotSelection(text: string, offered: { option: number; displayText: string; startIso: string }[]): SlotSelectionParse {
  const t = text.trim().toLowerCase();
  if (!t) return { kind: 'unclear' };
  if (/^1\b|^one\b|^first\b/.test(t)) return { kind: 'option', option: 1 };
  if (/^2\b|^two\b|^second\b/.test(t)) return { kind: 'option', option: 2 };
  if (/^3\b|^three\b|^third\b/.test(t)) return { kind: 'option', option: 3 };
  const digit = /^(\d)\b/.exec(t);
  if (digit) {
    const n = parseInt(digit[1]!, 10);
    if (n >= 1 && n <= 3) return { kind: 'option', option: n };
  }
  const hm = extractPreferredTime(text);
  if (hm) {
    return { kind: 'time', normalizedHm: hm };
  }
  return { kind: 'unclear' };
}

/** Match offered display text containing same hour as normalizedHm (HH:MM). */
export function matchOfferedByHm(
  offered: { option: number; displayText: string; startIso: string }[],
  normalizedHm: string,
): { option: number; displayText: string; startIso: string } | undefined {
  const [hhRaw, mmRaw] = normalizedHm.split(':');
  const hh = parseInt(hhRaw ?? '', 10);
  const mm = parseInt(mmRaw ?? '0', 10);
  if (!Number.isFinite(hh)) return undefined;
  const mmSafe = Number.isFinite(mm) ? mm : 0;
  const needle = new Date();
  needle.setHours(hh, mmSafe, 0, 0);
  const wantH = needle.getHours();
  const wantM = needle.getMinutes();
  for (const o of offered) {
    const d = new Date(o.startIso);
    if (!Number.isFinite(d.getTime())) continue;
    if (d.getHours() === wantH && d.getMinutes() === wantM) return o;
  }
  if (offered.length === 1) return offered[0];
  return undefined;
}
