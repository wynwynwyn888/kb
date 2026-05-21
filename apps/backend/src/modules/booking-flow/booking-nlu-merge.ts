import type { TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
import type { AisbpBookingStateV1, AisbpPreferredTimeWindow } from './conversation-booking-state';
import type { BookingNluOutput } from './booking-nlu.schema';
import { nluAllowsSchedulingOverwrite } from './booking-nlu-planner';
import {
  customSelectAnswerIsWholeOptionList,
  isAcceptedBookingServiceValue,
  isGenericBookingServicePhrase,
  matchUserLineToMenuOption,
  resolveServiceFromUserReplyLine,
} from './booking-service-intake';
import { extractPhone, resolveBookingCalendarDay, resolveRelativeDayPhrase } from './booking-intent-and-parse';

/** NLU below this confidence is ignored; deterministic intake still runs. */
export const BOOKING_NLU_MIN_MERGE_CONFIDENCE = 0.55;

export type BookingNluMergeSkipReason =
  | 'low_confidence'
  | 'no_fields'
  | 'generic_service'
  | 'invalid_service'
  | 'invalid_custom_option'
  | 'invalid_past_date'
  | 'invalid_date'
  | 'invalid_time';

export type BookingNluMergeResult = {
  mergedFieldKeys: string[];
  skipReason?: BookingNluMergeSkipReason;
  /** Caller should log `bookingNluDateRepaired` when set. */
  dateRepair?: { oldDate: string; newDate: string; sourceText: string };
};

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normalizeHm(raw: string): string | undefined {
  const t = raw.trim();
  const m = HM.exec(t);
  if (!m) return undefined;
  const hh = Math.min(23, parseInt(m[1]!, 10));
  const mm = Math.min(59, parseInt(m[2]!, 10));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseYmd(s: string): boolean {
  return /^(\d{4})-(\d{2})-(\d{2})$/.test(s.trim());
}

const WINDOW_MAP: Record<string, AisbpPreferredTimeWindow> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  lunch: 'lunch',
  noon: 'noon',
  after_work: 'after_work',
  before_lunch: 'before_lunch',
};

/** Field keys present in NLU output (for logs only — no values). */
export function listNluExtractedFieldKeysForLog(nlu: Pick<BookingNluOutput, 'fields'>): string[] {
  const keys: string[] = [];
  const f = nlu.fields;
  if (f.service?.trim()) keys.push('service');
  if (f.preferredDate?.trim()) keys.push('preferredDate');
  if (f.preferredTime?.trim()) keys.push('preferredTime');
  if (f.preferredTimeWindow) keys.push('preferredTimeWindow');
  if (f.name?.trim()) keys.push('name');
  if (f.phone?.trim()) keys.push('phone');
  if (f.email?.trim()) keys.push('email');
  if (f.firstVisit) keys.push('firstVisit');
  for (const [id, v] of Object.entries(f.customAnswers ?? {})) {
    if (v?.trim()) keys.push(`customAnswers:${id}`);
  }
  return keys;
}

function pickMergeSkipReason(flags: {
  genericService: boolean;
  invalidService: boolean;
  invalidCustomOption: boolean;
  invalidPastDate: boolean;
  invalidDate: boolean;
  invalidTime: boolean;
}): BookingNluMergeSkipReason {
  if (flags.genericService) return 'generic_service';
  if (flags.invalidService) return 'invalid_service';
  if (flags.invalidCustomOption) return 'invalid_custom_option';
  if (flags.invalidPastDate) return 'invalid_past_date';
  if (flags.invalidDate) return 'invalid_date';
  if (flags.invalidTime) return 'invalid_time';
  return 'no_fields';
}

/** True when the user message includes a four-digit year (19xx / 20xx). */
export function bookingUserTextHasExplicitFourDigitYear(text: string): boolean {
  return /\b(19|20)\d{2}\b/.test((text ?? '').trim());
}

function deterministicDateFromUserLines(latest: string, combined: string, crmTodayYmd: string): string | undefined {
  const tryOne = (s: string) =>
    resolveRelativeDayPhrase(s, crmTodayYmd) ?? resolveBookingCalendarDay(s, crmTodayYmd);
  const lt = latest.trim();
  const cb = combined.trim();
  return tryOne(lt) ?? (cb && cb !== lt ? tryOne(cb) : undefined);
}

/**
 * Apply NLU-extracted fields only when confidence is high enough and values pass the same
 * safety checks as deterministic intake (no generic service, menu/custom option matching).
 * Does not apply slot picks — the deterministic engine owns offered-slot selection.
 */
export function mergeValidatedNluIntoBooking(
  booking: AisbpBookingStateV1,
  settings: TenantBookingSettingsDto,
  nlu: BookingNluOutput,
  opts: {
    minConfidence: number;
    intent: BookingNluOutput['intent'];
    pendingFieldId?: string | null;
    /** CRM (or tenant) local `YYYY-MM-DD` — used to repair / reject NLU dates. */
    crmTodayYmd: string;
    latestInboundText: string;
    combinedInboundText: string;
  },
): BookingNluMergeResult {
  if (nlu.confidence < opts.minConfidence) {
    return { mergedFieldKeys: [], skipReason: 'low_confidence' };
  }

  const f = nlu.fields;
  const flags = {
    genericService: false,
    invalidService: false,
    invalidCustomOption: false,
    invalidPastDate: false,
    invalidDate: false,
    invalidTime: false,
  };
  const mergedFieldKeys: string[] = [];
  let dateRepair: BookingNluMergeResult['dateRepair'];
  const scheduleOverwrite = nluAllowsSchedulingOverwrite(opts.intent, booking);

  const clearNoSlotsRecoveryState = (): void => {
    booking.noSlotsForDateYmd = undefined;
    booking.noSlotsWideSearchDone = undefined;
    booking.offeredSlots = undefined;
    booking.offeredSlotsCrmTimeZone = undefined;
    booking.lastOfferedAt = undefined;
    booking.selectedSlot = undefined;
  };

  if (!booking.service?.trim() && f.service?.trim()) {
    const s = f.service.trim();
    if (isGenericBookingServicePhrase(s)) {
      flags.genericService = true;
    } else {
      const resolved = resolveServiceFromUserReplyLine(s, settings.serviceMenuOptions);
      if (resolved && isAcceptedBookingServiceValue(resolved, settings.serviceMenuOptions)) {
        booking.service = resolved;
        mergedFieldKeys.push('service');
      } else {
        flags.invalidService = true;
      }
    }
  }

  const mergePreferredDate = (): void => {
    if (!f.preferredDate?.trim()) return;
    const rawNlu = f.preferredDate.trim();
    if (!parseYmd(rawNlu)) {
      flags.invalidDate = true;
      return;
    }
    const explicitYear =
      bookingUserTextHasExplicitFourDigitYear(opts.latestInboundText) ||
      bookingUserTextHasExplicitFourDigitYear(opts.combinedInboundText);
    const det = deterministicDateFromUserLines(
      opts.latestInboundText,
      opts.combinedInboundText,
      opts.crmTodayYmd,
    );
    let chosen: string | undefined;
    if (!explicitYear) {
      if (det) {
        chosen = det;
        if (det !== rawNlu) {
          dateRepair = {
            oldDate: rawNlu,
            newDate: det,
            sourceText: opts.latestInboundText.trim().slice(0, 240),
          };
        }
      } else if (rawNlu < opts.crmTodayYmd) {
        flags.invalidPastDate = true;
      } else {
        chosen = rawNlu;
      }
    } else {
      chosen = rawNlu;
    }
    if (chosen !== undefined && !explicitYear && chosen < opts.crmTodayYmd) {
      flags.invalidPastDate = true;
      chosen = undefined;
      dateRepair = undefined;
    }
    if (chosen === undefined || flags.invalidPastDate) return;
    const prev = booking.preferredDate?.trim();
    if (!prev || scheduleOverwrite || chosen !== prev) {
      if (prev && chosen !== prev) clearNoSlotsRecoveryState();
      booking.preferredDate = chosen;
      mergedFieldKeys.push('preferredDate');
    }
  };

  if (!booking.preferredDate?.trim() || scheduleOverwrite) {
    mergePreferredDate();
  }
  if (scheduleOverwrite && !mergedFieldKeys.includes('preferredDate')) {
    const detOnly = deterministicDateFromUserLines(
      opts.latestInboundText,
      opts.combinedInboundText,
      opts.crmTodayYmd,
    );
    if (detOnly && detOnly !== booking.preferredDate?.trim()) {
      clearNoSlotsRecoveryState();
      booking.preferredDate = detOnly;
      mergedFieldKeys.push('preferredDate');
    }
  }

  const mergePreferredTime = (): void => {
    if (!f.preferredTime?.trim()) return;
    const t = normalizeHm(f.preferredTime);
    if (t) {
      booking.preferredTime = t;
      booking.preferredTimeWindow = 'exact';
      mergedFieldKeys.push('preferredTime');
      if (scheduleOverwrite) clearNoSlotsRecoveryState();
    } else {
      flags.invalidTime = true;
    }
  };

  if (!booking.preferredTime?.trim() || scheduleOverwrite) {
    mergePreferredTime();
  }

  if ((!booking.preferredTime?.trim() || scheduleOverwrite) && f.preferredTimeWindow) {
    const w = WINDOW_MAP[f.preferredTimeWindow];
    if (w) {
      booking.preferredTimeWindow = w;
      if (scheduleOverwrite && opts.intent === 'revise_date_time') {
        booking.preferredTime = undefined;
      }
      mergedFieldKeys.push('preferredTimeWindow');
      if (scheduleOverwrite) clearNoSlotsRecoveryState();
    }
  }

  if (!booking.customerName?.trim() && f.name?.trim()) {
    const n = f.name.trim();
    if (n.length <= 80 && /^[A-Za-z][A-Za-z\s'.-]*$/.test(n)) {
      booking.customerName = n.replace(/\b\w/g, c => c.toUpperCase());
      mergedFieldKeys.push('name');
    }
  }

  if (!booking.phone?.trim() && f.phone?.trim()) {
    const p = extractPhone(f.phone) ?? extractPhone(f.phone.replace(/\s+/g, ' '));
    if (p) {
      booking.phone = p;
      mergedFieldKeys.push('phone');
    }
  }

  if (!booking.email?.trim() && f.email?.trim()) {
    const e = f.email.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      booking.email = e;
      mergedFieldKeys.push('email');
    }
  }

  if (!booking.firstVisit?.trim() && f.firstVisit) {
    booking.firstVisit = f.firstVisit;
    mergedFieldKeys.push('firstVisit');
  }

  const custom = f.customAnswers ?? {};
  if (Object.keys(custom).length) {
    if (!booking.customAnswers) booking.customAnswers = {};
    for (const cf of settings.customFieldsJson) {
      const v = custom[cf.id]?.trim();
      if (!v) continue;
      if (booking.customAnswers[cf.id]?.trim()) continue;
      if (cf.fieldType === 'single_select' || cf.fieldType === 'single_choice') {
        const matched = matchUserLineToMenuOption(v, cf.options);
        if (matched) {
          if (!customSelectAnswerIsWholeOptionList(matched, cf.options)) {
            booking.customAnswers[cf.id] = matched;
            mergedFieldKeys.push(`customAnswers:${cf.id}`);
          } else {
            flags.invalidCustomOption = true;
          }
        } else {
          flags.invalidCustomOption = true;
        }
      } else if (v.length <= 500) {
        booking.customAnswers[cf.id] = v;
        mergedFieldKeys.push(`customAnswers:${cf.id}`);
      }
    }
  }

  const pid = opts.pendingFieldId?.trim();
  if (pid?.startsWith('custom:')) {
    const id = pid.slice('custom:'.length);
    const cf = settings.customFieldsJson.find(c => c.id === id);
    const v = custom[id]?.trim();
    if (cf && v && !booking.customAnswers?.[id]?.trim()) {
      if (cf.fieldType === 'single_select' || cf.fieldType === 'single_choice') {
        const matched = matchUserLineToMenuOption(v, cf.options);
        if (matched && !customSelectAnswerIsWholeOptionList(matched, cf.options)) {
          if (!booking.customAnswers) booking.customAnswers = {};
          booking.customAnswers[id] = matched;
          if (!mergedFieldKeys.includes(`customAnswers:${id}`)) {
            mergedFieldKeys.push(`customAnswers:${id}`);
          }
        } else {
          flags.invalidCustomOption = true;
        }
      }
    }
  }

  if (mergedFieldKeys.length > 0) {
    return { mergedFieldKeys, ...(dateRepair ? { dateRepair } : {}) };
  }

  const extractedKeys = listNluExtractedFieldKeysForLog(nlu);
  if (extractedKeys.length === 0) {
    return { mergedFieldKeys: [], skipReason: 'no_fields' };
  }

  return { mergedFieldKeys: [], skipReason: pickMergeSkipReason(flags) };
}
