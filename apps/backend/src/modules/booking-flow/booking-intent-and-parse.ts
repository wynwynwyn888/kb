/**
 * Lightweight booking intent + field extraction for conversation booking automation.
 * Avoids over-triggering on generic price questions without booking language.
 */

import type { AisbpPreferredTimeWindow } from './conversation-booking-state';

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

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};
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
  const ref = new Date(Date.UTC(base.y, base.m - 1, base.d));
  const curDow = ref.getUTCDay();

  const dowIndex = (name: string): number | undefined => {
    const n = name.toLowerCase();
    const map: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    return map[n];
  };

  const thisNext = /\b(this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text);
  if (thisNext) {
    const which = thisNext[1]!.toLowerCase();
    const dTarget = dowIndex(thisNext[2]!);
    if (dTarget === undefined) return undefined;
    let delta = (dTarget - curDow + 7) % 7;
    if (which === 'this') {
      if (delta === 0) return todayYmd;
      return addDays(delta);
    }
    if (delta === 0) return addDays(7);
    return addDays(delta + 7);
  }

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
  for (const { re, d } of dow) {
    if (re.test(t)) {
      const delta = (d - curDow + 7) % 7;
      if (delta === 0) return todayYmd;
      return addDays(delta);
    }
  }

  const m = YMD.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return resolveBookingCalendarDay(text, todayYmd);
}

/** Day-first slash dates (e.g. 21/5), day-month names (21 May), and ISO — uses todayYmd as reference for implied year. */
export function resolveBookingCalendarDay(text: string, todayYmd: string): string | undefined {
  const ref = parseYmd(todayYmd);
  if (!ref) return undefined;

  const tryBuild = (y: number, m: number, d: number): string | undefined => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
    return formatYmd(dt);
  };

  const pickYearForMd = (month: number, day: number): string | undefined => {
    let y = ref.y;
    let cand = tryBuild(y, month, day);
    if (!cand) return undefined;
    if (cand < todayYmd) {
      y += 1;
      cand = tryBuild(y, month, day);
    }
    return cand;
  };

  const mSlash = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(text);
  if (mSlash) {
    const a = parseInt(mSlash[1]!, 10);
    const b = parseInt(mSlash[2]!, 10);
    const yPart = mSlash[3];
    let month: number;
    let day: number;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }
    let year = ref.y;
    if (yPart) {
      const yn = parseInt(yPart, 10);
      year = yn < 100 ? 2000 + yn : yn;
    } else {
      const cand0 = tryBuild(year, month, day);
      if (cand0 && cand0 < todayYmd) year += 1;
    }
    return tryBuild(year, month, day);
  }

  const m1 = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i.exec(
    text,
  );
  if (m1) {
    const day = parseInt(m1[1]!, 10);
    const mk = m1[2]!.toLowerCase();
    const month = MONTH_NAMES[mk];
    if (month && Number.isFinite(day)) return pickYearForMd(month, day);
  }

  const m2 = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(
    text,
  );
  if (m2) {
    const mk = m2[1]!.toLowerCase();
    const day = parseInt(m2[2]!, 10);
    const month = MONTH_NAMES[mk];
    if (month && Number.isFinite(day)) return pickYearForMd(month, day);
  }

  return undefined;
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Add whole calendar days to a `YYYY-MM-DD` string (UTC calendar math; matches other booking date helpers). */
export function addCalendarDaysUtcYmd(ymd: string, deltaDays: number): string | undefined {
  const p = parseYmd(ymd.trim());
  if (!p) return undefined;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + deltaDays));
  return formatYmd(dt);
}

function formatYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * When the user writes an ordinal day ("28th") without a month name, infer the next upcoming
 * calendar date for that day-of-month in CRM-local space (same rolling logic as named months).
 */
export function tryInferUpcomingOrdinalDayYmd(text: string, crmTodayYmd: string): string | undefined {
  const ref = parseYmd(crmTodayYmd.trim());
  if (!ref) return undefined;

  const tryBuild = (y: number, m: number, d: number): string | undefined => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
    return formatYmd(dt);
  };

  const mOrd = /\b(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text);
  if (!mOrd) return undefined;
  const day = parseInt(mOrd[1]!, 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return undefined;
  const tail = text.slice((mOrd.index ?? 0) + mOrd[0].length, (mOrd.index ?? 0) + mOrd[0].length + 96);
  if (
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
      tail,
    )
  ) {
    return undefined;
  }

  let y = ref.y;
  let mo = ref.m;
  for (let i = 0; i < 14; i++) {
    const cand = tryBuild(y, mo, day);
    if (cand && cand >= crmTodayYmd.trim()) return cand;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return undefined;
}

/** Ordinal day number when no trailing month token (for clarification copy). */
export function extractOrdinalDayWithoutMonthName(text: string): number | undefined {
  const mOrd = /\b(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text);
  if (!mOrd) return undefined;
  const day = parseInt(mOrd[1]!, 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return undefined;
  const tail = text.slice((mOrd.index ?? 0) + mOrd[0].length, (mOrd.index ?? 0) + mOrd[0].length + 96);
  if (
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
      tail,
    )
  ) {
    return undefined;
  }
  return day;
}

export function extractEmail(text: string): string | undefined {
  const m = text.match(EMAIL);
  return m ? m[0]!.trim() : undefined;
}

export function extractPhone(text: string): string | undefined {
  const m = text.match(PHONE);
  return m ? m[0]!.replace(/\s+/g, ' ').trim() : undefined;
}

/** HH:MM 24h, 3pm, 2.30pm, around 10 / around 10am — trailing fillers stripped. */
export function extractPreferredTime(text: string): string | undefined {
  let t = text.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  t = t.replace(/\b(man|please|thanks|thank you|sir|madam|buddy|mate)\b/gi, ' ').replace(/\s+/g, ' ').trim();

  const around = /\baround\s+(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?\b/i.exec(t);
  if (around) {
    let h = parseInt(around[1]!, 10);
    const mm = around[2] ? parseInt(around[2]!, 10) : 0;
    const ap = around[3]?.toLowerCase();
    if (!ap && h >= 1 && h <= 12) {
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (ap === 'pm' || ap === 'am') {
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  const dotPm = /\b(\d{1,2})\.(\d{2})\s*(am|pm)\b/i.exec(t);
  if (dotPm) {
    let h = parseInt(dotPm[1]!, 10);
    const mm = parseInt(dotPm[2]!, 10);
    const ap = dotPm[3]!.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

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

/** Broad time-of-day phrases (CRM-local windows applied when offering slots). */
export function extractPreferredTimeWindow(text: string): AisbpPreferredTimeWindow | undefined {
  const t = text.toLowerCase();
  if (/\b(before\s+lunch|prior\s+to\s+lunch)\b/.test(t)) return 'before_lunch';
  if (/\b(lunch\s*time|lunchtime)\b/.test(t)) return 'lunch';
  if (/\b(after\s+work|afterwork)\b/.test(t)) return 'after_work';
  if (/\bnoon\b/.test(t)) return 'noon';
  if (/\blunch\b/.test(t)) return 'lunch';
  if (/\bevening\b/.test(t)) return 'evening';
  if (/\bafternoon\b/.test(t)) return 'afternoon';
  if (/\bmorning\b/.test(t)) return 'morning';
  return undefined;
}

/** User complains about being asked to pick again — do not treat embedded time as an implicit slot confirmation. */
export function shouldSuppressImplicitSlotPickFromFrustration(latestInboundText: string): boolean {
  const t = latestInboundText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  if (
    /\b(why\s+(do\s+)?you\s+still\s+ask|why\s+u\s+still\s+ask|still\s+ask(\s+me)?|stop\s+asking)\b/i.test(t)
  ) {
    return true;
  }
  if (/\bwhy\b.*\b(still\s+)?ask/i.test(t) && /\b(i\s+said|already\s+said|told\s+you)\b/i.test(t)) return true;
  return false;
}

/** Single-slot “reserve this time?” confirmation line — must not fire on multi-option lists. */
export function parseExactSlotReservationAffirmative(latestInboundText: string): boolean {
  const s = stripBookingFrustrationForParse(latestInboundText.replace(/\s+/g, ' ').trim()).cleaned.toLowerCase();
  if (!s) return false;
  if (/^(y|yes|yeah|yep|yup|ok|okay|sure|confirm|pls|please|can)\s*[!.?]*$/i.test(s)) return true;
  if (/^(ok|yes|yeah|yep|yup)(\s+(please|pls|thanks|thank\s+you))?\s*[!.?]*$/i.test(s)) return true;
  if (/^(please|pls)(\s+(yes|ok|yeah|yep))?\s*[!.?]*$/i.test(s)) return true;
  if (/\b(book\s+it|please\s+reserve|reserve\s+(it|please)|go\s+ahead)\b/i.test(s)) return true;
  return false;
}

export function parseExactSlotReservationNegative(latestInboundText: string): boolean {
  const s = stripBookingFrustrationForParse(latestInboundText.replace(/\s+/g, ' ').trim()).cleaned.toLowerCase();
  if (!s) return false;
  if (/^(no|nope|nah)\s*[!.?]*$/i.test(s)) return true;
  if (/\b(another\s+time|different\s+time|not\s+that|something\s+else)\b/i.test(s)) return true;
  return false;
}

/** First / all-in-one message asked whether a time is available (prefer “Shall I reserve…” confirmation tone). */
export function userCombinedMessageAskedAvailabilityQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  if (/\b(is\s+)?(this|that)\s+timing\s+available\b/i.test(t)) return true;
  if (/\b(is\s+)?(it|that)\s+available\b/i.test(t) && /\b(time|slot|timing)\b/i.test(t)) return true;
  if (/\bany\s+(opening|availability)\b/i.test(t) && /\?/.test(t)) return true;
  return false;
}

/** First free slot whose CRM-local start matches normalized HH:MM (when the calendar has that exact start). */
export function findExactSlotMatchingPreferredHm<T extends { startTime: string }>(
  slots: T[],
  preferredHm: string,
  crmTimeZone: string,
): T | undefined {
  const tm = normalizedHmToMinutes(preferredHm);
  if (tm === undefined) return undefined;
  for (const s of slots) {
    const sm = slotStartLocalMinutes(s.startTime, crmTimeZone);
    if (sm === tm) return s;
  }
  return undefined;
}

export function stripBookingFrustrationForParse(raw: string): { cleaned: string; hadFrustration: boolean } {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return { cleaned: '', hadFrustration: false };
  const patterns = [
    /\bi\s+told\s+you\b\.?/gi,
    /\bi\s+told\s+u\b\.?/gi,
    /\balready\s+said\b/gi,
    /\bwhy\s+ask\s+again\b/gi,
    /\bare\s+you\s+stupid\b/gi,
    /\bcan\s+you\s+read\b/gi,
    /\bi\s+said\s+already\b/gi,
    /\bright\s*\?/gi,
    /\bagain\?\s*/gi,
  ];
  let had = false;
  for (const re of patterns) {
    if (re.test(s)) {
      had = true;
      s = s.replace(re, ' ');
    }
  }
  s = s.replace(/\bright\s*$/gi, ' ').replace(/\s+/g, ' ').trim();
  return { cleaned: s, hadFrustration: had };
}

export function getSlotHourMinuteInZone(iso: string, timeZone: string): { h: number; m: number } | undefined {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return undefined;
  const tz = timeZone?.trim() || 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const hh = parts.find(p => p.type === 'hour')?.value;
    const mm = parts.find(p => p.type === 'minute')?.value;
    if (hh === undefined || mm === undefined) return undefined;
    const h = parseInt(hh, 10);
    const m = parseInt(mm, 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
    return { h, m };
  } catch {
    return undefined;
  }
}

export function minutesFromMidnight(h: number, m: number): number {
  return h * 60 + m;
}

export function timeWindowLocalRangeMinutes(
  window: AisbpPreferredTimeWindow,
): { start: number; end: number } | undefined {
  switch (window) {
    case 'morning':
      return { start: 8 * 60, end: 11 * 60 + 59 };
    case 'afternoon':
      return { start: 12 * 60, end: 17 * 60 + 59 };
    case 'evening':
      return { start: 18 * 60, end: 21 * 60 };
    case 'noon':
    case 'lunch':
      return { start: 12 * 60, end: 14 * 60 };
    case 'after_work':
      return { start: 17 * 60, end: 21 * 60 };
    case 'before_lunch':
      return { start: 8 * 60, end: 12 * 60 };
    default:
      return undefined;
  }
}

/** Filter free slots whose local start time falls inside the window (inclusive). */
export function filterFreeSlotsByTimeWindow<T extends { startTime: string }>(
  slots: T[],
  window: AisbpPreferredTimeWindow,
  crmTimeZone: string,
): T[] {
  if (window === 'exact') return slots;
  const r = timeWindowLocalRangeMinutes(window);
  if (!r) return slots;
  return slots.filter(s => {
    const hm = getSlotHourMinuteInZone(s.startTime, crmTimeZone);
    if (!hm) return true;
    const mins = minutesFromMidnight(hm.h, hm.m);
    return mins >= r.start && mins <= r.end;
  });
}

/** Minutes from midnight for a CRM-local HH:MM preference string. */
export function normalizedHmToMinutes(hm: string): number | undefined {
  const parts = hm.trim().split(':');
  const hh = parseInt(parts[0] ?? '', 10);
  const mm = parseInt(parts[1] ?? '0', 10);
  if (!Number.isFinite(hh)) return undefined;
  return hh * 60 + (Number.isFinite(mm) ? mm : 0);
}

/** CRM-local minutes-from-midnight for a slot start ISO instant. */
export function slotStartLocalMinutes(iso: string, crmTimeZone: string): number | undefined {
  const hm = getSlotHourMinuteInZone(iso, crmTimeZone);
  if (!hm) return undefined;
  return minutesFromMidnight(hm.h, hm.m);
}

/**
 * Rank real CRM slots for offer: optional window filter (with fallback to full list),
 * then by exact preferred time first, then closest to preferred time, else chronological.
 */
export function rankSlotsForBookingOffer<T extends { startTime: string }>(
  slots: T[],
  opts: {
    preferredHm?: string;
    preferredWindow?: AisbpPreferredTimeWindow;
    crmTimeZone: string;
    max: number;
  },
): { ranked: T[]; usedWindowFallback: boolean; hasExactPreferredTimeMatch: boolean } {
  const tz = opts.crmTimeZone?.trim() || 'UTC';
  const uniq = new Map<string, T>();
  for (const s of slots) {
    if (!uniq.has(s.startTime)) uniq.set(s.startTime, s);
  }
  let pool = [...uniq.values()];
  let usedWindowFallback = false;
  const win = opts.preferredWindow;
  if (win && win !== 'exact' && pool.length > 0) {
    const filtered = filterFreeSlotsByTimeWindow(pool, win, tz);
    if (filtered.length >= 1) pool = filtered;
    else usedWindowFallback = true;
  }
  const targetMins = opts.preferredHm ? normalizedHmToMinutes(opts.preferredHm) : undefined;
  let hasExactPreferredTimeMatch = false;
  if (targetMins !== undefined && Number.isFinite(targetMins)) {
    pool.sort((a, b) => {
      const ta = slotStartLocalMinutes(a.startTime, tz);
      const tb = slotStartLocalMinutes(b.startTime, tz);
      if (ta === undefined || tb === undefined) return Date.parse(a.startTime) - Date.parse(b.startTime);
      const exactA = ta === targetMins ? 1 : 0;
      const exactB = tb === targetMins ? 1 : 0;
      if (exactA !== exactB) return exactB - exactA;
      const distA = Math.abs(ta - targetMins);
      const distB = Math.abs(tb - targetMins);
      if (distA !== distB) return distA - distB;
      return ta - tb;
    });
    const firstM = pool[0] ? slotStartLocalMinutes(pool[0].startTime, tz) : undefined;
    hasExactPreferredTimeMatch = firstM !== undefined && firstM === targetMins;
  } else {
    pool.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  }
  return { ranked: pool.slice(0, opts.max), usedWindowFallback, hasExactPreferredTimeMatch };
}

export function extractServiceGuess(text: string): string | undefined {
  return extractServiceFromBookingMessage(text) ?? legacyExtractServiceGuess(text);
}

function legacyExtractServiceGuess(text: string): string | undefined {
  const t = text.trim();
  const m = /\b(book|schedule|appointment)\s+(?:for\s+)?(?:a\s+)?([a-z0-9][a-z0-9\s&'-]{2,40})/i.exec(t);
  if (m && m[2]) return m[2]!.trim();
  return undefined;
}

/** Service phrase after book/want to book, stopping before date/time prepositions. */
export function extractServiceFromBookingMessage(text: string): string | undefined {
  const t = text.replace(/\s+/g, ' ').trim();
  const re =
    /\b(?:want\s+to|would\s+like\s+to|like\s+to|need\s+to)?\s*book(?:ing)?(?:\s+for)?\s+(?:an?\s+)?(.+?)(?=\s+(?:on|at|around|from|between|the|this|next|tomorrow|today)\s|\s+(?:\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b)|(?:\d{1,2}[/-]\d{1,2})|\s+20\d{2}\b|$)/i;
  const m = re.exec(t);
  if (!m?.[1]) return undefined;
  let s = m[1].trim();
  s = s.replace(/\s+for\s+you\s*$/i, '').trim();
  if (s.length < 2 || s.length > 120) return undefined;
  return s;
}

export function extractNameGuess(text: string): string | undefined {
  const m = /\b(?:i'?m|i am|name is|this is)\s+([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)\b/.exec(text);
  if (m) return m[1]!.trim().replace(/\b\w/g, c => c.toUpperCase());
  return undefined;
}

/** Plain name from a reply line when we already asked for their name (short, human-looking). */
export function parsePlainNameAnswerLine(raw: string): string | undefined {
  let t = raw.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80) return undefined;
  if (/^(1|2|3|one|two|three)\b/i.test(t)) return undefined;
  if (/\b(book|appointment|cancel|complaint|reschedule|human|stop)\b/i.test(t) && t.length > 24) return undefined;
  t = t.replace(
    /^(?:i\s*told\s+(?:u|you)\s*|my\s+name\s+is\s+|it'?s\s+|this\s+is\s+|name\s*[:']?\s*|call\s+me\s+)/i,
    '',
  );
  t = t.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  if (words.length > 4) return undefined;
  const candidate = words
    .map(w => w.replace(/^[^A-Za-z]+|[^A-Za-z'.-]+$/g, ''))
    .filter(Boolean)
    .join(' ');
  if (!candidate || candidate.length < 1 || candidate.length > 48) return undefined;
  if (!/^[A-Za-z][A-Za-z\s'.-]*$/.test(candidate)) return undefined;
  return candidate.replace(/\b\w/g, c => c.toUpperCase());
}

export function extractFirstVisit(text: string): string | undefined {
  if (/\bfirst\s+(visit|time)\b/i.test(text)) return 'yes';
  if (/\b(returning|been\s+before|regular)\b/i.test(text)) return 'no';
  return undefined;
}

/**
 * Natural-language first-visit answers when `pendingFieldId === first_visit`.
 * Lowercases, strips punctuation, tolerates polite fillers (dear, thanks, …).
 */
export function parseFirstVisitNaturalReply(raw: string): 'yes' | 'no' | undefined {
  let s = raw.trim().toLowerCase();
  if (!s) return undefined;
  s = s.replace(/[''`´]/g, ' ');
  s = s.replace(/[^a-z0-9\s]/gi, ' ');
  s = s.replace(/\b(dear|thanks|thank you|please|sir|madam|hello|hi|hey)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;

  const noPhrases = [
    'not my first visit',
    'not my first time',
    'not first visit',
    'not a first visit',
    'not the first time',
    'returning customer',
    'returning client',
    'existing customer',
    'existing client',
    'been before',
    'came before',
    'regular customer',
    'regular client',
    'i am returning',
    "i'm returning",
    'im returning',
  ];
  for (const p of noPhrases) {
    if (s.includes(p)) return 'no';
  }

  const yesPhrases = [
    'first time',
    'first visit',
    'new customer',
    'new client',
    'this is my first visit',
    'my first visit',
    'i am new',
    "i'm new",
    'im new',
    'first timer',
  ];
  for (const p of yesPhrases) {
    if (s.includes(p)) return 'yes';
  }

  if (/\b(yes|yeah|yup|yep|correct|absolutely|definitely|sure)\b/.test(s) && /\bfirst\b/.test(s) && /\b(visit|time)\b/.test(s)) {
    return 'yes';
  }

  if (/^(y|yes|yeah|yup|yep|correct|absolutely|definitely|sure)\b/.test(s)) return 'yes';
  if (/^(n|no|nope|nah)\b/.test(s)) return 'no';

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
  const hmEarly = extractPreferredTime(text);
  if (hmEarly) {
    return { kind: 'time', normalizedHm: hmEarly };
  }
  if (/^1\b|^one\b|^first\b/.test(t)) return { kind: 'option', option: 1 };
  if (/^2\b|^two\b|^second\b/.test(t)) return { kind: 'option', option: 2 };
  if (/^3\b|^three\b|^third\b/.test(t)) return { kind: 'option', option: 3 };
  const digit = /^(\d)\b/.exec(t);
  if (digit) {
    const n = parseInt(digit[1]!, 10);
    if (n >= 1 && n <= 3) return { kind: 'option', option: n };
  }
  return { kind: 'unclear' };
}

/** Match offered display text containing same hour as normalizedHm (HH:MM). */
export function matchOfferedByHm(
  offered: { option: number; displayText: string; startIso: string }[],
  normalizedHm: string,
  crmTimeZone?: string,
): { option: number; displayText: string; startIso: string } | undefined {
  const want = normalizedHmToMinutes(normalizedHm);
  if (want === undefined) return undefined;
  const tz = crmTimeZone?.trim();
  for (const o of offered) {
    if (tz) {
      const sm = slotStartLocalMinutes(o.startIso, tz);
      if (sm === want) return o;
    } else {
      const [hhRaw, mmRaw] = normalizedHm.split(':');
      const hh = parseInt(hhRaw ?? '', 10);
      const mm = parseInt(mmRaw ?? '0', 10);
      if (!Number.isFinite(hh)) continue;
      const mmSafe = Number.isFinite(mm) ? mm : 0;
      const needle = new Date();
      needle.setHours(hh, mmSafe, 0, 0);
      const wantH = needle.getHours();
      const wantM = needle.getMinutes();
      const d = new Date(o.startIso);
      if (!Number.isFinite(d.getTime())) continue;
      if (d.getHours() === wantH && d.getMinutes() === wantM) return o;
    }
  }
  return undefined;
}

export type SlotSelectionOrTimeRevision =
  | { kind: 'selected_slot'; slot: { option: number; displayText: string; startIso: string; calendarId?: string } }
  | { kind: 'time_revision'; preferredTime: string }
  | { kind: 'time_window_revision'; preferredTimeWindow: AisbpPreferredTimeWindow }
  | {
      kind: 'date_time_revision';
      preferredDate: string;
      preferredTime?: string;
      preferredTimeWindow?: AisbpPreferredTimeWindow;
    }
  | { kind: 'unparseable' };

export function resolveBookingDateFromInboundText(text: string, todayYmd: string): string | undefined {
  return resolveRelativeDayPhrase(text, todayYmd) ?? resolveBookingCalendarDay(text, todayYmd);
}

/**
 * In `offered_slots` state: detect picking a listed slot vs revising time/window/date for a fresh fetch.
 *
 * @param latestInboundText — Current user line only. When it is exactly `1`, `2`, or `3` (after trim + frustration strip),
 *   that line alone selects the listed option index — combined thread is not scanned for times (avoids `3pm` in history
 *   stealing a bare `3`).
 * @param combinedThreadForRevision — Earlier transcript lines for date/time revision when the latest line is not a bare option index.
 */
export function parseSlotSelectionOrTimeRevision(
  latestInboundText: string,
  combinedThreadForRevision: string,
  offeredSlots: { option: number; displayText: string; startIso: string; calendarId?: string }[],
  crmTimezone: string,
  currentPreferredDate: string,
  todayYmd: string,
): SlotSelectionOrTimeRevision {
  const latestClean = stripBookingFrustrationForParse(latestInboundText.replace(/\s+/g, ' ').trim()).cleaned;
  if (/^[123]$/.test(latestClean)) {
    const n = parseInt(latestClean, 10);
    const slot = offeredSlots.find(o => o.option === n);
    if (slot) return { kind: 'selected_slot', slot };
    return { kind: 'unparseable' };
  }

  if (parseExactSlotReservationAffirmative(latestInboundText)) {
    if (offeredSlots.length === 1) {
      return { kind: 'selected_slot', slot: offeredSlots[0]! };
    }
    const hmAff =
      extractPreferredTime(latestClean) ??
      extractPreferredTime(
        stripBookingFrustrationForParse(combinedThreadForRevision.replace(/\s+/g, ' ').trim()).cleaned,
      );
    if (hmAff) {
      const matched = matchOfferedByHm(offeredSlots, hmAff, crmTimezone);
      if (matched) return { kind: 'selected_slot', slot: matched };
    }
  }

  const selectionText = [latestInboundText, combinedThreadForRevision].filter(s => s?.trim()).join('\n');
  const cleaned = stripBookingFrustrationForParse(selectionText.replace(/\s+/g, ' ').trim()).cleaned;
  if (!cleaned) return { kind: 'unparseable' };
  const curDate = currentPreferredDate.trim();
  const newDate = resolveBookingDateFromInboundText(cleaned, todayYmd);

  const hm = extractPreferredTime(cleaned);
  const winOnly = !hm ? extractPreferredTimeWindow(cleaned) : undefined;

  if (newDate && newDate !== curDate) {
    if (hm) return { kind: 'date_time_revision', preferredDate: newDate, preferredTime: hm };
    if (winOnly) return { kind: 'date_time_revision', preferredDate: newDate, preferredTimeWindow: winOnly };
    return { kind: 'unparseable' };
  }

  if (hm) {
    if (shouldSuppressImplicitSlotPickFromFrustration(latestInboundText)) {
      return { kind: 'unparseable' };
    }
    const m = matchOfferedByHm(offeredSlots, hm, crmTimezone);
    if (m) return { kind: 'selected_slot', slot: m };
    return { kind: 'time_revision', preferredTime: hm };
  }

  if (winOnly) return { kind: 'time_window_revision', preferredTimeWindow: winOnly };

  const sel = parseSlotSelection(cleaned, offeredSlots);
  if (sel.kind === 'option') {
    const slot = offeredSlots.find(o => o.option === sel.option);
    if (slot) return { kind: 'selected_slot', slot };
    return { kind: 'unparseable' };
  }
  if (sel.kind === 'time') {
    const m2 = matchOfferedByHm(offeredSlots, sel.normalizedHm, crmTimezone);
    if (m2) return { kind: 'selected_slot', slot: m2 };
    return { kind: 'time_revision', preferredTime: sel.normalizedHm };
  }
  return { kind: 'unparseable' };
}
