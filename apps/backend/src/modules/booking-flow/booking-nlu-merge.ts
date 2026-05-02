import type { TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
import type { AisbpBookingStateV1, AisbpPreferredTimeWindow } from './conversation-booking-state';
import type { BookingNluOutput } from './booking-nlu.schema';
import {
  customSelectAnswerIsWholeOptionList,
  isAcceptedBookingServiceValue,
  isGenericBookingServicePhrase,
  matchUserLineToMenuOption,
  resolveServiceFromUserReplyLine,
} from './booking-service-intake';
import { extractPhone } from './booking-intent-and-parse';

/** NLU below this confidence is ignored; deterministic intake still runs. */
export const BOOKING_NLU_MIN_MERGE_CONFIDENCE = 0.55;

export type BookingNluMergeSkipReason =
  | 'low_confidence'
  | 'no_fields'
  | 'generic_service'
  | 'invalid_service'
  | 'invalid_custom_option'
  | 'invalid_date'
  | 'invalid_time';

export type BookingNluMergeResult = {
  mergedFieldKeys: string[];
  skipReason?: BookingNluMergeSkipReason;
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
  invalidDate: boolean;
  invalidTime: boolean;
}): BookingNluMergeSkipReason {
  if (flags.genericService) return 'generic_service';
  if (flags.invalidService) return 'invalid_service';
  if (flags.invalidCustomOption) return 'invalid_custom_option';
  if (flags.invalidDate) return 'invalid_date';
  if (flags.invalidTime) return 'invalid_time';
  return 'no_fields';
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
  opts: { minConfidence: number; pendingFieldId?: string | null },
): BookingNluMergeResult {
  if (nlu.confidence < opts.minConfidence) {
    return { mergedFieldKeys: [], skipReason: 'low_confidence' };
  }

  const f = nlu.fields;
  const flags = {
    genericService: false,
    invalidService: false,
    invalidCustomOption: false,
    invalidDate: false,
    invalidTime: false,
  };
  const mergedFieldKeys: string[] = [];

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

  if (!booking.preferredDate?.trim() && f.preferredDate?.trim()) {
    const d = f.preferredDate.trim();
    if (parseYmd(d)) {
      booking.preferredDate = d;
      mergedFieldKeys.push('preferredDate');
    } else {
      flags.invalidDate = true;
    }
  }

  if (!booking.preferredTime?.trim() && f.preferredTime?.trim()) {
    const t = normalizeHm(f.preferredTime);
    if (t) {
      booking.preferredTime = t;
      booking.preferredTimeWindow = 'exact';
      mergedFieldKeys.push('preferredTime');
    } else {
      flags.invalidTime = true;
    }
  }

  if (!booking.preferredTime?.trim() && f.preferredTimeWindow) {
    const w = WINDOW_MAP[f.preferredTimeWindow];
    if (w) {
      booking.preferredTimeWindow = w;
      mergedFieldKeys.push('preferredTimeWindow');
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
    return { mergedFieldKeys };
  }

  const extractedKeys = listNluExtractedFieldKeysForLog(nlu);
  if (extractedKeys.length === 0) {
    return { mergedFieldKeys: [], skipReason: 'no_fields' };
  }

  return { mergedFieldKeys: [], skipReason: pickMergeSkipReason(flags) };
}
