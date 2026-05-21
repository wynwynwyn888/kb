import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import { customFieldIncludedInSummary } from './booking-summary';
import type { BookingCoreFieldKey } from '../../lib/tenant-automation-constants';
import type { AisbpBookingStateV1 } from './conversation-booking-state';
import { labelForBatchBookingDetailField, type BatchBookingDetailField } from './booking-conversation-copy';
import {
  extractEmail,
  extractFirstVisit,
  extractNameGuess,
  extractPhone,
  parseFirstVisitNaturalReply,
  parsePlainNameAnswerLine,
} from './booking-intent-and-parse';
import { matchUserLineToMenuOption } from './booking-service-intake';
import { isOptionalSkipIntent } from './booking-pending-field';
import { isPreSchedulingIntakeComplete } from './booking-flow-guards';

export const BATCH_DETAILS_PENDING_ID = 'batch:details';

export const PRE_SCHEDULING_ASK_PRIORITY: readonly BookingCoreFieldKey[] = [
  'service',
  'preferred_date',
  'preferred_time',
];

export const POST_SCHEDULING_ASK_PRIORITY: readonly BookingCoreFieldKey[] = [
  'name',
  'phone',
  'email',
  'first_visit',
];

/** True once the customer has named a specific time (HH:mm), not only a broad window. */
export function isSchedulingTimeLocked(booking: AisbpBookingStateV1): boolean {
  return Boolean(booking.preferredTime?.trim());
}

function readCoreValue(booking: AisbpBookingStateV1, key: BookingCoreFieldKey): string | undefined {
  switch (key) {
    case 'name':
      return booking.customerName;
    case 'phone':
      return booking.phone;
    case 'email':
      return booking.email;
    case 'first_visit':
      return booking.firstVisit;
    case 'service':
      return booking.service;
    case 'preferred_date':
      return booking.preferredDate;
    case 'preferred_time':
      return booking.preferredTime;
    default:
      return undefined;
  }
}

function appendUnique(list: string[] | undefined, id: string): string[] {
  const cur = list ? [...list] : [];
  if (!cur.includes(id)) cur.push(id);
  return cur;
}

function readCore(booking: AisbpBookingStateV1, key: BookingCoreFieldKey): string | undefined {
  switch (key) {
    case 'name':
      return booking.customerName;
    case 'phone':
      return booking.phone;
    case 'email':
      return booking.email;
    case 'first_visit':
      return booking.firstVisit;
    case 'service':
      return booking.service;
    case 'preferred_date':
      return booking.preferredDate;
    case 'preferred_time':
      return booking.preferredTime;
    default:
      return undefined;
  }
}

function isFieldSkipped(booking: AisbpBookingStateV1, fieldId: string): boolean {
  return (booking.skippedFieldIds ?? []).includes(fieldId);
}

function isOptionalAsked(booking: AisbpBookingStateV1, fieldId: string): boolean {
  return (booking.optionalAskedFieldIds ?? []).includes(fieldId);
}

function sortedCustomFields(customFieldsJson: CustomBookingFieldDto[]): CustomBookingFieldDto[] {
  return [...customFieldsJson].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function listBatchDetailsMissingFieldIds(
  settings: { coreFieldsJson: Record<string, { enabled?: boolean; required?: boolean }>; customFieldsJson: CustomBookingFieldDto[] },
  booking: AisbpBookingStateV1,
): string[] {
  if (!isPreSchedulingIntakeComplete(settings, booking)) return [];
  const out: string[] = [];
  for (const key of POST_SCHEDULING_ASK_PRIORITY) {
    const t = settings.coreFieldsJson[key];
    if (!t?.enabled) continue;
    const v = readCore(booking, key);
    if (v?.trim()) continue;
    if (!t.required) {
      if (isFieldSkipped(booking, key)) continue;
      if (isOptionalAsked(booking, key)) continue;
    }
    out.push(key);
  }
  for (const cf of sortedCustomFields(settings.customFieldsJson)) {
    if (!customFieldIncludedInSummary(cf)) continue;
    const id = `custom:${cf.id}`;
    const ans = booking.customAnswers?.[cf.id];
    if (ans?.trim()) continue;
    if (!cf.required) {
      if (isFieldSkipped(booking, id)) continue;
      if (isOptionalAsked(booking, id)) continue;
    }
    out.push(id);
  }
  return out;
}

export function toBatchBookingDetailFields(
  fieldIds: string[],
  settings: { customFieldsJson: CustomBookingFieldDto[] },
  isRequired: (fieldId: string) => boolean,
): BatchBookingDetailField[] {
  return fieldIds.map(id => ({
    id,
    label: labelForBatchBookingDetailField(id, settings.customFieldsJson),
    required: isRequired(id),
  }));
}

/** Parse a free-text reply against all pending batch fields (name, phone, email, first visit, customs). */
export function applyBatchDetailsFromInbound(params: {
  booking: AisbpBookingStateV1;
  latest: string;
  combinedHint: string;
  settings: { customFieldsJson: CustomBookingFieldDto[]; serviceMenuOptions?: string[] };
  pendingFieldIds: string[];
}): { parsedAny: boolean } {
  const { booking, latest, combinedHint, settings, pendingFieldIds } = params;
  const text = `${combinedHint}\n${latest}`.trim();
  const line = latest.trim();
  let parsedAny = false;

  /** Comma-separated batch replies (e.g. "Jane Doe, 9123 4567, first time, …") exceed parsePlainNameAnswerLine's word cap on the full line. */
  const commaSegments = (): string[] => {
    if (!line.includes(',')) return [line];
    const parts = line
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const uniq: string[] = [];
    for (const p of [line, ...parts]) {
      if (!uniq.includes(p)) uniq.push(p);
    }
    return uniq;
  };

  if (pendingFieldIds.includes('name') && !booking.customerName?.trim()) {
    let n: string | undefined;
    for (const seg of commaSegments()) {
      n = parsePlainNameAnswerLine(seg) ?? extractNameGuess(seg);
      if (n) break;
    }
    if (!n) n = extractNameGuess(text);
    if (n) {
      booking.customerName = n;
      parsedAny = true;
    }
  }
  if (pendingFieldIds.includes('phone') && !booking.phone?.trim()) {
    const p = extractPhone(text) ?? extractPhone(line);
    if (p) {
      booking.phone = p;
      parsedAny = true;
    }
  }
  if (pendingFieldIds.includes('email') && !booking.email?.trim()) {
    const e = extractEmail(text) ?? extractEmail(line);
    if (e) {
      booking.email = e;
      parsedAny = true;
    }
  }
  if (pendingFieldIds.includes('first_visit') && !booking.firstVisit?.trim()) {
    let fv: string | undefined;
    for (const seg of commaSegments()) {
      fv =
        parseFirstVisitNaturalReply(seg) ??
        extractFirstVisit(seg);
      if (fv) break;
    }
    if (!fv) {
      fv = parseFirstVisitNaturalReply(text) ?? extractFirstVisit(text);
    }
    if (fv) {
      booking.firstVisit = fv;
      parsedAny = true;
    }
  }

  for (const fieldId of pendingFieldIds) {
    if (!fieldId.startsWith('custom:')) continue;
    const cfId = fieldId.slice('custom:'.length);
    const cf = settings.customFieldsJson.find(c => c.id === cfId);
    if (!cf) continue;
    if (booking.customAnswers?.[cfId]?.trim()) continue;
    if (cf.fieldType === 'single_select' || cf.fieldType === 'single_choice') {
      let hit: string | undefined;
      for (const seg of commaSegments()) {
        hit = matchUserLineToMenuOption(seg, cf.options ?? []);
        if (hit) break;
      }
      if (hit) {
        booking.customAnswers = { ...(booking.customAnswers ?? {}), [cfId]: hit };
        parsedAny = true;
      }
    } else if (line.length > 0 && !isOptionalSkipIntent(line)) {
      const parts = line
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      const value = parts.length > 1 ? parts[parts.length - 1]! : line;
      booking.customAnswers = { ...(booking.customAnswers ?? {}), [cfId]: value };
      parsedAny = true;
    }
  }

  if (line.trim() && isOptionalSkipIntent(line)) {
    for (const fieldId of pendingFieldIds) {
      booking.skippedFieldIds = appendUnique(booking.skippedFieldIds, fieldId);
      booking.optionalAskedFieldIds = appendUnique(booking.optionalAskedFieldIds, fieldId);
    }
  }

  return { parsedAny };
}

function isBatchFieldEmpty(booking: AisbpBookingStateV1, fieldId: string): boolean {
  if (fieldId === 'name') return !booking.customerName?.trim();
  if (fieldId === 'phone') return !booking.phone?.trim();
  if (fieldId === 'email') return !booking.email?.trim();
  if (fieldId === 'first_visit') return !booking.firstVisit?.trim();
  if (fieldId.startsWith('custom:')) {
    return !booking.customAnswers?.[fieldId.slice('custom:'.length)]?.trim();
  }
  return false;
}

export function finalizeBatchDetailsPending(params: {
  booking: AisbpBookingStateV1;
  pendingFieldIds: string[];
  isFieldRequired: (fieldId: string) => boolean;
}): { requiredStillMissing: string[] } {
  const { booking, pendingFieldIds, isFieldRequired } = params;
  const requiredStillMissing: string[] = [];
  for (const fieldId of pendingFieldIds) {
    const empty = isBatchFieldEmpty(booking, fieldId);
    if (!empty) continue;
    if (isFieldRequired(fieldId)) {
      requiredStillMissing.push(fieldId);
      continue;
    }
    booking.optionalAskedFieldIds = appendUnique(booking.optionalAskedFieldIds, fieldId);
  }
  if (requiredStillMissing.length === 0) {
    booking.pendingFieldId = undefined;
    booking.pendingFieldLabel = undefined;
    booking.pendingFieldRequired = undefined;
    booking.pendingBatchFieldIds = undefined;
  } else {
    booking.pendingBatchFieldIds = requiredStillMissing;
    booking.pendingFieldRequired = true;
  }
  return { requiredStillMissing };
}
