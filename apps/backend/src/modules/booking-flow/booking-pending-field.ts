import type { AisbpBookingStateV1 } from './conversation-booking-state';
import {
  extractEmail,
  extractFirstVisit,
  extractNameGuess,
  extractPhone,
  extractPreferredTime,
  parsePlainNameAnswerLine,
  resolveBookingCalendarDay,
  resolveRelativeDayPhrase,
  parseFirstVisitNaturalReply,
} from './booking-intent-and-parse';

export type ApplyPendingFieldAnswerResult = {
  answered: boolean;
  fieldId?: string;
  skippedOptional?: boolean;
  /** When answered=true: whether a concrete field value was stored (false for optional skip). */
  parsedValue?: boolean;
};

/** Phrases that skip an optional Ask field (not a bare "no", which may answer first_visit). */
export function isOptionalSkipIntent(line: string): boolean {
  const s = line.trim().toLowerCase();
  if (!s) return false;
  if (/^(skip|pass|none|n\/a|na|later|not now)\s*$/i.test(s)) return true;
  if (/^(no thanks|no thank you|maybe later)\s*$/i.test(s)) return true;
  if (/^don'?t have\b/i.test(s) || /^dont have\b/i.test(s)) return true;
  if (/^i\s+don'?t\s+have\b/i.test(s)) return true;
  return false;
}

function appendUnique(list: string[] | undefined, id: string): string[] {
  const cur = list ? [...list] : [];
  if (!cur.includes(id)) cur.push(id);
  return cur;
}

/**
 * Normalize a short yes/no style reply (e.g. strips trailing "?" from "yes?").
 * Exported for unit tests.
 */
export function parseFirstVisitDirectAnswer(raw: string): 'yes' | 'no' | undefined {
  let s = raw.trim().toLowerCase();
  if (!s) return undefined;
  s = s.replace(/^[\s"'“”‘’.,!?;:()[\]{}«»–—-]+|[\s"'“”‘’.,!?;:()[\]{}«»–—-]+$/g, '').trim();
  while (s.length > 0 && /[.!?…]+$/.test(s)) {
    s = s.replace(/[.!?…]+$/g, '').trim();
  }
  if (!s) return undefined;

  if (/^(first\s*time|first\s*visit|new(\s+customer)?)$/.test(s)) return 'yes';
  if (/^(returning(\s+customer)?|existing(\s+customer)?|been\s+before|regular(\s+customer)?)$/.test(s)) {
    return 'no';
  }
  if (/^(y|yes|yep|yeah|yup|correct|absolutely|definitely|sure|indeed)$/.test(s)) return 'yes';
  if (/^(n|no|nope|nah)$/.test(s)) return 'no';
  return undefined;
}

/**
 * When the bot asked for a specific field (`pendingFieldId`), interpret the next inbound line
 * primarily as an answer to that field (not generic booking chatter).
 */
export function applyPendingFieldAnswer(params: {
  booking: AisbpBookingStateV1;
  latest: string;
  todayYmd: string;
}): ApplyPendingFieldAnswerResult {
  const pid = (params.booking.pendingFieldId ?? '').trim();
  if (!pid) return { answered: false };

  const line = params.latest.trim();
  if (!line) return { answered: false };

  const { booking, todayYmd } = params;
  const required = booking.pendingFieldRequired === true;

  const clearPending = () => {
    booking.pendingFieldId = undefined;
    booking.pendingFieldLabel = undefined;
    booking.pendingFieldRequired = undefined;
  };

  if (!required && isOptionalSkipIntent(line)) {
    booking.skippedFieldIds = appendUnique(booking.skippedFieldIds, pid);
    booking.optionalAskedFieldIds = appendUnique(booking.optionalAskedFieldIds, pid);
    clearPending();
    return { answered: true, fieldId: pid, skippedOptional: true, parsedValue: false };
  }

  if (pid === 'name') {
    const n = parsePlainNameAnswerLine(line) ?? extractNameGuess(line);
    if (n) {
      booking.customerName = n;
      clearPending();
      return { answered: true, fieldId: 'name', parsedValue: true };
    }
    return { answered: false };
  }

  if (pid === 'phone') {
    const p = extractPhone(line);
    if (p) {
      booking.phone = p;
      clearPending();
      return { answered: true, fieldId: 'phone', parsedValue: true };
    }
    return { answered: false };
  }

  if (pid === 'email') {
    const e = extractEmail(line);
    if (e) {
      booking.email = e;
      clearPending();
      return { answered: true, fieldId: 'email', parsedValue: true };
    }
    return { answered: false };
  }

  if (pid === 'service') {
    const s = line.replace(/\s+/g, ' ').trim();
    if (s.length >= 2 && s.length <= 120) {
      booking.service = s;
      clearPending();
      return { answered: true, fieldId: 'service', parsedValue: true };
    }
    return { answered: false };
  }

  if (pid === 'preferred_date') {
    const d = resolveRelativeDayPhrase(line, todayYmd) ?? resolveBookingCalendarDay(line, todayYmd);
    if (d) {
      booking.preferredDate = d;
      clearPending();
      return { answered: true, fieldId: 'preferred_date', parsedValue: true };
    }
    return { answered: false };
  }

  if (pid === 'preferred_time') {
    const t = extractPreferredTime(line);
    if (t) {
      booking.preferredTime = t;
      clearPending();
      return { answered: true, fieldId: 'preferred_time', parsedValue: true };
    }
    return { answered: false };
  }

  if (pid === 'first_visit') {
    const natural = parseFirstVisitNaturalReply(line);
    if (natural) {
      booking.firstVisit = natural;
      clearPending();
      return { answered: true, fieldId: 'first_visit', parsedValue: true };
    }
    const phrase = extractFirstVisit(line);
    if (phrase) {
      booking.firstVisit = phrase;
      clearPending();
      return { answered: true, fieldId: 'first_visit', parsedValue: true };
    }
    const direct = parseFirstVisitDirectAnswer(line);
    if (direct) {
      booking.firstVisit = direct;
      clearPending();
      return { answered: true, fieldId: 'first_visit', parsedValue: true };
    }
    return { answered: false };
  }

  if (pid.startsWith('custom:')) {
    const id = pid.slice('custom:'.length);
    if (!id) return { answered: false };
    if (!booking.customAnswers) booking.customAnswers = {};
    booking.customAnswers[id] = line;
    clearPending();
    return { answered: true, fieldId: pid, parsedValue: true };
  }

  return { answered: false };
}
