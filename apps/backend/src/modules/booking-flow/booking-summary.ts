import type { BookingCoreFieldKey } from '../../lib/tenant-automation-constants';
import type { CoreFieldToggle } from '../../lib/tenant-automation-validation';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import type { AisbpBookingStateV1, AisbpOfferedSlot } from './conversation-booking-state';
import { customSelectAnswerIsWholeOptionList, isAcceptedBookingServiceValue } from './booking-service-intake';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Original GHL conversation contact (who messaged). Not booking intake. */
export interface ConversationContactSnapshot {
  displayName?: string;
  phone?: string;
}

export interface BuildBookingSummaryTextInput {
  appointmentId?: string;
  bookingStatusLabel: string;
  booking: AisbpBookingStateV1;
  coreFieldsJson: Record<string, CoreFieldToggle>;
  customFieldsJson: CustomBookingFieldDto[];
  /** CRM contact on the conversation thread — for "Contacted from" only. */
  conversationContactSnapshot?: ConversationContactSnapshot;
  calendarName?: string;
  selectedSlot: AisbpOfferedSlot;
  crmTimeZone?: string;
  /** When set, invalid / generic `booking.service` values render as "-" in staff summaries. */
  serviceMenuOptions?: string[];
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

function formatLongDateFromIso(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone && timeZone.trim() ? timeZone : 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(d);
    const day = parts.find(p => p.type === 'day')?.value ?? '';
    const month = parts.find(p => p.type === 'month')?.value ?? '';
    const year = parts.find(p => p.type === 'year')?.value ?? '';
    if (day && month && year) return `${day} ${month} ${year}`;
  } catch {
    // fall through
  }
  return d.toISOString().slice(0, 10);
}

function formatTimeRange(startIso: string, endIso: string, timeZone: string | undefined): string {
  const tz = timeZone && timeZone.trim() ? timeZone : 'UTC';
  const opt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: tz };
  try {
    const a = new Date(startIso);
    const b = new Date(endIso);
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return '';
    const t1 = a.toLocaleTimeString('en-US', opt);
    const t2 = b.toLocaleTimeString('en-US', opt);
    return `${t1} - ${t2}`;
  } catch {
    return '';
  }
}

/** Title-case service string without lowercasing acronyms aggressively. */
export function titleCaseServiceLine(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return s;
  return s
    .split(/\s+/)
    .map(w => {
      if (!w) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

export function formatFirstVisitForSummary(booking: AisbpBookingStateV1): string {
  if (booking.skippedFieldIds?.includes('first_visit')) return 'Skipped';
  const v = booking.firstVisit?.trim().toLowerCase();
  if (!v) return '-';
  if (v === 'yes' || v === 'y') return 'Yes';
  if (v === 'no' || v === 'n') return 'No';
  return booking.firstVisit!.trim();
}

/** Include intake line when Ask (enabled) OR Required — matches tenant normalization semantics. */
export function coreFieldIncludedInSummary(
  settings: Record<string, CoreFieldToggle>,
  key: BookingCoreFieldKey,
): boolean {
  const t = settings[key];
  if (!t) return false;
  return Boolean(t.enabled || t.required);
}

export function customFieldIncludedInSummary(cf: CustomBookingFieldDto): boolean {
  return cf.enabled !== false || Boolean(cf.required);
}

function coreLine(
  booking: AisbpBookingStateV1,
  key: BookingCoreFieldKey,
  serviceMenuOptions: string[] | undefined,
): { value: string; skipped: boolean } {
  if (booking.skippedFieldIds?.includes(key)) return { value: 'Skipped', skipped: true };
  switch (key) {
    case 'name':
      return { value: booking.customerName?.trim() || '-', skipped: false };
    case 'phone':
      return { value: booking.phone?.trim() || '-', skipped: false };
    case 'email':
      return { value: booking.email?.trim() || '-', skipped: false };
    case 'service': {
      const t = booking.service?.trim();
      if (!t || !isAcceptedBookingServiceValue(t, serviceMenuOptions)) return { value: '-', skipped: false };
      return { value: titleCaseServiceLine(t), skipped: false };
    }
    case 'preferred_date': {
      const ymd = booking.preferredDate?.trim();
      if (!ymd) return { value: '-', skipped: false };
      const p = parseYmd(ymd);
      if (!p) return { value: ymd, skipped: false };
      return { value: `${p.d} ${MONTHS[p.m - 1] ?? ''} ${p.y}`.trim(), skipped: false };
    }
    case 'preferred_time':
      return { value: booking.preferredTime?.trim() || '-', skipped: false };
    case 'first_visit':
      return { value: '-', skipped: false };
    default:
      return { value: '-', skipped: false };
  }
}

/**
 * Staff-facing booking summary. Booking intake lines only when Ask OR Required.
 * Always includes system header/footer (no GHL contact id, appointment owner, or conversation id).
 */
export function buildBookingSummaryText(input: BuildBookingSummaryTextInput): string {
  const lines: string[] = [];
  lines.push('New booking alert');
  lines.push('');

  const id = input.appointmentId?.trim();
  if (id) lines.push(`Booking ID: ${id}`);
  lines.push(`Booking status: ${(input.bookingStatusLabel || 'Confirmed').trim()}`);
  lines.push('');

  const core = input.coreFieldsJson;
  const slot = input.selectedSlot;
  const tz = input.crmTimeZone;
  const svcMenu = input.serviceMenuOptions;

  if (coreFieldIncludedInSummary(core, 'service')) {
    const { value, skipped } = coreLine(input.booking, 'service', svcMenu);
    lines.push(`Service: ${skipped ? 'Skipped' : value}`);
  }

  const dateIn = coreFieldIncludedInSummary(core, 'preferred_date');
  const timeIn = coreFieldIncludedInSummary(core, 'preferred_time');
  if (dateIn) {
    lines.push(`Booking date: ${formatLongDateFromIso(slot.startIso, tz)}`);
  }
  if (timeIn) {
    const range = formatTimeRange(slot.startIso, slot.endIso || slot.startIso, tz);
    lines.push(`Booking time: ${range || slot.displayText || '-'}`);
  }

  lines.push('');

  if (coreFieldIncludedInSummary(core, 'name')) {
    const { value, skipped } = coreLine(input.booking, 'name', svcMenu);
    lines.push(`Booking name: ${skipped ? 'Skipped' : value}`);
  }
  if (coreFieldIncludedInSummary(core, 'phone')) {
    const { value, skipped } = coreLine(input.booking, 'phone', svcMenu);
    lines.push(`Booking phone: ${skipped ? 'Skipped' : value}`);
  }
  if (coreFieldIncludedInSummary(core, 'email')) {
    const { value, skipped } = coreLine(input.booking, 'email', svcMenu);
    lines.push(`Booking email: ${skipped ? 'Skipped' : value}`);
  }
  if (coreFieldIncludedInSummary(core, 'first_visit')) {
    lines.push(`First visit: ${formatFirstVisitForSummary(input.booking)}`);
  }

  lines.push('');
  lines.push(`Calendar: ${(input.calendarName ?? input.booking.calendarId ?? '-').trim() || '-'}`);
  lines.push('Source: AISBP booking assistant');

  const customLines: string[] = [];
  for (const cf of [...input.customFieldsJson].sort((a, b) => a.displayOrder - b.displayOrder)) {
    if (!customFieldIncludedInSummary(cf)) continue;
    const ansRaw = input.booking.customAnswers?.[cf.id]?.trim();
    let ans = ansRaw;
    if (
      ans &&
      (cf.fieldType === 'single_select' || cf.fieldType === 'single_choice') &&
      customSelectAnswerIsWholeOptionList(ans, cf.options)
    ) {
      ans = undefined;
    }
    const skippedCustom = input.booking.skippedFieldIds?.includes(`custom:${cf.id}`);
    const label = cf.label.trim() || cf.id;
    if (skippedCustom) customLines.push(`- ${label}: Skipped`);
    else customLines.push(`- ${label}: ${ans && ans.length ? ans : '-'}`);
  }
  if (customLines.length) {
    lines.push('');
    lines.push('Custom fields:');
    lines.push(...customLines);
  }

  const snap = input.conversationContactSnapshot;
  const crmName = snap?.displayName?.trim() || '-';
  const crmPhone = snap?.phone?.trim() || '-';

  lines.push('');
  lines.push('Contacted from:');
  lines.push(`CRM contact name: ${crmName}`);
  lines.push(`CRM contact phone: ${crmPhone}`);

  return lines.join('\n');
}

/** Max length for GHL appointment `notes` on create (defensive). */
export function truncateForGhlNotes(text: string, maxLen = 3500): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 20)}\n…(truncated)`;
}

/** Notes on appointment create (no appointment id yet). */
export function buildAppointmentCreateNotes(input: Omit<BuildBookingSummaryTextInput, 'appointmentId'>): string {
  return truncateForGhlNotes(
    buildBookingSummaryText({
      ...input,
      appointmentId: undefined,
      bookingStatusLabel: 'Confirming',
    }),
  );
}
