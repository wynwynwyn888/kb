/**
 * Booking intake: service/purpose must not be filled from generic booking intent.
 * Custom select options may be stored as comma-joined strings — expand before matching.
 */

import { extractServiceFromBookingMessage } from './booking-intent-and-parse';

/** Split tenant option rows that were saved as "A,B,C" into individual choices. */
export function expandBookingSelectOptions(options: string[] | undefined): string[] {
  if (!options?.length) return [];
  return options.flatMap(o => o.split(',').map(p => p.trim()).filter(Boolean));
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Lowercase compare key for intent / menu matching. */
export function normalizeBookingCompareKey(s: string): string {
  return collapseWs(s)
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/[?!.]+$/g, '')
    .trim();
}

/** True when the whole phrase is generic booking intent, not a service name. */
export function isGenericBookingServicePhrase(s: string): boolean {
  const t = normalizeBookingCompareKey(s);
  if (!t) return true;
  const exact = new Set([
    'i want to book',
    'want to book',
    'i want an appointment',
    'i want a appointment',
    'book appointment',
    'book an appointment',
    'book a appointment',
    'i need appointment',
    'i need an appointment',
    'i need a appointment',
    'can i book',
    'could i book',
    'booking',
    'make appointment',
    'make an appointment',
    'make a appointment',
    'appointment please',
    'schedule appointment',
    'schedule an appointment',
    'id like to book',
    'i would like to book',
    'i need to book',
    'book please',
    'book now',
    'book me in',
    'reserve appointment',
    'get an appointment',
  ]);
  if (exact.has(t)) return true;
  if (/^(?:hi|hello|hey)[,!\s]+(?:i\s+)?want\s+to\s+book$/i.test(collapseWs(s))) return true;
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match user line to one expanded menu option (case-insensitive). */
export function matchUserLineToMenuOption(line: string, menuOptions: string[] | undefined): string | undefined {
  if (!menuOptions?.length) return undefined;
  const expanded = expandBookingSelectOptions(menuOptions);
  if (!expanded.length) return undefined;
  const lt = normalizeBookingCompareKey(line);
  if (!lt) return undefined;
  for (const opt of expanded) {
    const key = normalizeBookingCompareKey(opt);
    if (!key) continue;
    if (lt === key) return opt;
    if (new RegExp(`\\b${escapeRe(key)}\\b`, 'i').test(line)) return opt;
  }
  return undefined;
}

const KEYWORD_SERVICE: { re: RegExp; label: string }[] = [
  { re: /\bscalp\s+treatment\b/i, label: 'Scalp Treatment' },
  { re: /\bwash\s+and\s+cut\b/i, label: 'Wash and Cut' },
  { re: /\bhair\s*colou?r\b/i, label: 'Hair Colour' },
  { re: /\bhair\s*cut\b|\bhaircut\b/i, label: 'Haircut' },
  { re: /\bcolou?r\b/i, label: 'Colour' },
  { re: /\bhighlights?\b/i, label: 'Highlights' },
  { re: /\bblow\s*dry\b|\bblowdry\b/i, label: 'Blow dry' },
  { re: /\btreatment\b/i, label: 'Treatment' },
];

export function matchKeywordServicePhrase(text: string): string | undefined {
  const t = collapseWs(text);
  if (!t) return undefined;
  for (const { re, label } of KEYWORD_SERVICE) {
    if (re.test(t)) return label;
  }
  return undefined;
}

/** If `stored` equals the entire option list (legacy bad value), treat as invalid. */
export function customSelectAnswerIsWholeOptionList(answer: string, options: string[] | undefined): boolean {
  const expanded = expandBookingSelectOptions(options);
  if (expanded.length < 2) return false;
  const parts = answer.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length !== expanded.length) return false;
  const want = new Set(expanded.map(o => normalizeBookingCompareKey(o)));
  const got = new Set(parts);
  if (got.size !== want.size) return false;
  for (const g of got) {
    if (!want.has(g)) return false;
  }
  return true;
}

function pickCanonicalMenuLabel(matchedLabel: string, menuOptions: string[] | undefined): string {
  if (!menuOptions?.length) return matchedLabel;
  const expanded = expandBookingSelectOptions(menuOptions);
  const key = normalizeBookingCompareKey(matchedLabel);
  for (const opt of expanded) {
    if (normalizeBookingCompareKey(opt) === key) return opt;
  }
  return matchedLabel;
}

/**
 * Resolve a service string from inbound lines. Never returns generic intent-only text.
 * When `menuOptions` is set, free-text must match a menu entry or a keyword that maps to one.
 */
export function resolveServiceFromBookingIntake(
  combined: string,
  latest: string,
  menuOptions: string[] | undefined,
): string | undefined {
  const blocks = [collapseWs(latest), collapseWs(combined), collapseWs(`${combined}\n${latest}`)].filter(Boolean);
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block)) continue;
    seen.add(block);
    const r = resolveServiceFromUserReplyLine(block, menuOptions);
    if (r) return r;
  }
  return undefined;
}

export function resolveServiceFromUserReplyLine(text: string, menuOptions: string[] | undefined): string | undefined {
  if (!text) return undefined;
  if (isGenericBookingServicePhrase(text)) return undefined;

  const fromMenuLine = matchUserLineToMenuOption(text, menuOptions);
  if (fromMenuLine) return pickCanonicalMenuLabel(fromMenuLine, menuOptions);

  const extracted = extractServiceFromBookingMessage(text);
  if (extracted) {
    const ex = collapseWs(extracted);
    if (!ex || isGenericBookingServicePhrase(ex)) return undefined;
    const fromMenuEx = matchUserLineToMenuOption(ex, menuOptions);
    if (fromMenuEx) return pickCanonicalMenuLabel(fromMenuEx, menuOptions);
    const kw = matchKeywordServicePhrase(ex);
    if (kw) {
      if (menuOptions?.length) {
        const mapped = matchUserLineToMenuOption(kw, menuOptions);
        if (mapped) return pickCanonicalMenuLabel(mapped, menuOptions);
        return undefined;
      }
      return kw;
    }
    if (menuOptions?.length) return undefined;
    if (ex.length >= 3 && !isGenericBookingServicePhrase(ex)) return ex;
  }

  const kwOnly = matchKeywordServicePhrase(text);
  if (kwOnly) {
    if (menuOptions?.length) {
      const mapped = matchUserLineToMenuOption(kwOnly, menuOptions);
      if (mapped) return pickCanonicalMenuLabel(mapped, menuOptions);
      return undefined;
    }
    return kwOnly;
  }

  if (menuOptions?.length) return undefined;
  return undefined;
}

/** Whether a stored service value should count as answered for required checks / summaries. */
export function isAcceptedBookingServiceValue(stored: string | undefined, menuOptions: string[] | undefined): boolean {
  const s = stored?.trim();
  if (!s) return false;
  if (isGenericBookingServicePhrase(s)) return false;
  if (menuOptions?.length) {
    return Boolean(matchUserLineToMenuOption(s, menuOptions));
  }
  if (matchKeywordServicePhrase(s)) return true;
  const ex = extractServiceFromBookingMessage(s);
  if (ex && !isGenericBookingServicePhrase(ex)) return true;
  return s.length >= 4 && !isGenericBookingServicePhrase(s);
}
