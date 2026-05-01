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
} from './booking-intent-and-parse';

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
 * When the bot asked for a specific field (`pendingFieldId`), interpret the next inbound line
 * primarily as an answer to that field (not generic booking chatter).
 */
export function applyPendingFieldAnswer(params: {
  booking: AisbpBookingStateV1;
  latest: string;
  todayYmd: string;
}): { answered: boolean; fieldId?: string; skippedOptional?: boolean } {
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
    return { answered: true, fieldId: pid, skippedOptional: true };
  }

  if (pid === 'name') {
    const n = parsePlainNameAnswerLine(line) ?? extractNameGuess(line);
    if (n) {
      booking.customerName = n;
      clearPending();
      return { answered: true, fieldId: 'name' };
    }
    return { answered: false };
  }

  if (pid === 'phone') {
    const p = extractPhone(line);
    if (p) {
      booking.phone = p;
      clearPending();
      return { answered: true, fieldId: 'phone' };
    }
    return { answered: false };
  }

  if (pid === 'email') {
    const e = extractEmail(line);
    if (e) {
      booking.email = e;
      clearPending();
      return { answered: true, fieldId: 'email' };
    }
    return { answered: false };
  }

  if (pid === 'service') {
    const s = line.replace(/\s+/g, ' ').trim();
    if (s.length >= 2 && s.length <= 120) {
      booking.service = s;
      clearPending();
      return { answered: true, fieldId: 'service' };
    }
    return { answered: false };
  }

  if (pid === 'preferred_date') {
    const d = resolveRelativeDayPhrase(line, todayYmd) ?? resolveBookingCalendarDay(line, todayYmd);
    if (d) {
      booking.preferredDate = d;
      clearPending();
      return { answered: true, fieldId: 'preferred_date' };
    }
    return { answered: false };
  }

  if (pid === 'preferred_time') {
    const t = extractPreferredTime(line);
    if (t) {
      booking.preferredTime = t;
      clearPending();
      return { answered: true, fieldId: 'preferred_time' };
    }
    return { answered: false };
  }

  if (pid === 'first_visit') {
    const fv = extractFirstVisit(line);
    if (fv) {
      booking.firstVisit = fv;
      clearPending();
      return { answered: true, fieldId: 'first_visit' };
    }
    if (/\b(yes|yep|yeah)\b/i.test(line) && !/\bno\b/i.test(line)) {
      booking.firstVisit = 'yes';
      clearPending();
      return { answered: true, fieldId: 'first_visit' };
    }
    if (/\b(no|nope|nah)\b/i.test(line)) {
      booking.firstVisit = 'no';
      clearPending();
      return { answered: true, fieldId: 'first_visit' };
    }
    return { answered: false };
  }

  if (pid.startsWith('custom:')) {
    const id = pid.slice('custom:'.length);
    if (!id) return { answered: false };
    if (!booking.customAnswers) booking.customAnswers = {};
    booking.customAnswers[id] = line;
    clearPending();
    return { answered: true, fieldId: pid };
  }

  return { answered: false };
}
