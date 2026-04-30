import type { GhlCalendarDetailSummary } from '@aisbp/ghl-client';

export const RULE_WARN_MEETING_LOCATION = 'BOOKING_RULE_MEETING_LOCATION';
export const RULE_WARN_MIN_NOTICE = 'BOOKING_RULE_MIN_NOTICE';
export const RULE_WARN_BOOKING_WINDOW = 'BOOKING_RULE_BOOKING_WINDOW';
export const RULE_WARN_SLOT_INTERVAL_BUFFER = 'BOOKING_RULE_SLOT_INTERVAL_BUFFER';
export const RULE_WARN_EXTERNAL_CONFLICT = 'BOOKING_RULE_EXTERNAL_CONFLICT';

export interface BookingRulesDiagnosticsDto {
  slotDuration: number | null;
  slotInterval: number | null;
  appointmentsPerSlot: number | null;
  bufferSummary: string;
  minNoticeSummary: string;
  bookingWindowSummary: string;
  meetingLocationPresent: boolean;
  meetingLocationType: string | null;
  conflictCheckSummary: string;
  formAttached: boolean;
  consentRequired: boolean;
  paymentRequired: boolean;
  servicesIncompleteHint: boolean;
  warnings: string[];
  warningCodes: string[];
}

function buildBufferSummary(s: GhlCalendarDetailSummary): string {
  const pre = s.preBufferMinutes;
  const post = s.postBufferMinutes;
  if (pre === undefined && post === undefined) return '—';
  return `pre ${pre ?? 0}m / post ${post ?? 0}m`;
}

function buildMinNoticeSummary(s: GhlCalendarDetailSummary): string {
  const m = s.minSchedulingNoticeMinutes;
  if (m === undefined || m === null) return '—';
  return `${m} min`;
}

function buildBookingWindowSummary(s: GhlCalendarDetailSummary): string {
  const a = s.bookingWindowStartYmd;
  const b = s.bookingWindowEndYmd;
  if (!a && !b) return '—';
  return `${a ?? '—'} → ${b ?? '—'}`;
}

function buildConflictSummary(s: GhlCalendarDetailSummary): string {
  const parts: string[] = [];
  if (s.conflictCheckEnabled) parts.push('CRM conflict check: on');
  if (s.googleConflictChecking) parts.push('Google busy check: on');
  if (parts.length === 0) return '—';
  return parts.join(' · ');
}

/** Virtual / dial-in types usually do not need a physical address. */
function meetingTypeLikelyNeedsAddress(type: string | null | undefined): boolean {
  const t = (type ?? '').toLowerCase().trim();
  if (!t) return true;
  if (
    t.includes('zoom') ||
    t.includes('meet') ||
    t.includes('teams') ||
    t.includes('gotomeeting') ||
    t.includes('phone')
  )
    return false;
  if (t.includes('custom') && t.includes('url')) return false;
  if (t === 'virtual') return false;
  return true;
}

function parseHmToMinutesFromMidnight(timeStr: string): number | null {
  const t = timeStr.trim();
  if (!t) return null;
  const pm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!pm) return null;
  const hour = parseInt(pm[1] ?? '', 10);
  const minute = parseInt(pm[2] ?? '', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export interface BookingRulesDiagnosticsContext {
  /** YYYY-MM-DD from the availability check */
  selectedDate: string;
  selectedTime: string;
  /** Start of the free-slots query window (UTC ms) */
  rangeStartMs: number;
  /** True when CRM returned zero slots (enables conflict heuristic) */
  zeroSlots: boolean;
}

export function computeBookingRulesDiagnostics(
  summary: GhlCalendarDetailSummary | undefined,
  ctx?: BookingRulesDiagnosticsContext,
): BookingRulesDiagnosticsDto {
  const warnings: string[] = [];
  const warningCodes: string[] = [];
  const push = (msg: string, code: string) => {
    if (!warningCodes.includes(code)) {
      warnings.push(msg);
      warningCodes.push(code);
    }
  };

  const s = summary;

  const slotDuration = s?.slotDuration ?? null;
  const slotInterval = s?.slotInterval ?? null;
  const appointmentsPerSlot = s?.appointmentsPerSlot ?? null;
  const bufferSummary = s ? buildBufferSummary(s) : '—';
  const minNoticeSummary = s ? buildMinNoticeSummary(s) : '—';
  const bookingWindowSummary = s ? buildBookingWindowSummary(s) : '—';
  const meetingLocationPresent = s?.meetingLocationPresent ?? false;
  const meetingLocationType = s?.meetingLocationType ?? null;
  const conflictCheckSummary = s ? buildConflictSummary(s) : '—';

  const formAttached = s?.formIdPresent ?? false;
  const consentRequired = s?.consentRequired ?? false;
  const paymentRequired = s?.paymentRequired ?? false;
  const servicesIncompleteHint = s?.servicesIncompleteHint ?? false;

  if (s && meetingTypeLikelyNeedsAddress(s.meetingLocationType) && !meetingLocationPresent) {
    push('Meeting location appears empty. Add a meeting location inside CRM.', RULE_WARN_MEETING_LOCATION);
  }

  if (ctx && s) {
    const noticeMin = s.minSchedulingNoticeMinutes;
    if (noticeMin !== undefined && noticeMin > 0) {
      const earliest = Date.now() + noticeMin * 60 * 1000;
      if (ctx.rangeStartMs < earliest) {
        push(
          'Booking rules may block this time because of minimum scheduling notice.',
          RULE_WARN_MIN_NOTICE,
        );
      }
    }

    const winStart = s.bookingWindowStartYmd;
    const winEnd = s.bookingWindowEndYmd;
    const sel = ctx.selectedDate.trim();
    if (winStart && sel < winStart) {
      push('Booking rules may exclude this selected date.', RULE_WARN_BOOKING_WINDOW);
    }
    if (winEnd && sel > winEnd) {
      push('Booking rules may exclude this selected date.', RULE_WARN_BOOKING_WINDOW);
    }

    const interval = s.slotInterval;
    const timeStr = ctx.selectedTime.trim();
    if (interval !== undefined && interval > 0 && timeStr) {
      const mins = parseHmToMinutesFromMidnight(timeStr);
      if (mins !== null && mins % interval !== 0) {
        push(
          'Slot interval or buffer settings may prevent this time from appearing.',
          RULE_WARN_SLOT_INTERVAL_BUFFER,
        );
      }
    }

    if (
      ctx.zeroSlots &&
      (s.conflictCheckEnabled || s.googleConflictChecking)
    ) {
      push(
        'External calendar conflict checking may be blocking availability.',
        RULE_WARN_EXTERNAL_CONFLICT,
      );
    }
  }

  return {
    slotDuration,
    slotInterval,
    appointmentsPerSlot,
    bufferSummary,
    minNoticeSummary,
    bookingWindowSummary,
    meetingLocationPresent,
    meetingLocationType,
    conflictCheckSummary,
    formAttached,
    consentRequired,
    paymentRequired,
    servicesIncompleteHint,
    warnings,
    warningCodes,
  };
}
