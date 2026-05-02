import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import type { AisbpPreferredTimeWindow } from './conversation-booking-state';
import { expandBookingSelectOptions } from './booking-service-intake';

/** Human label for CRM time window (staff / customer copy). */
export function timeWindowDisplayLabel(w: AisbpPreferredTimeWindow | undefined): string {
  switch (w) {
    case 'morning':
      return 'morning';
    case 'afternoon':
      return 'afternoon';
    case 'evening':
      return 'evening';
    case 'noon':
    case 'lunch':
      return 'midday';
    case 'after_work':
      return 'after work';
    case 'before_lunch':
      return 'morning';
    case 'exact':
    default:
      return 'preferred';
  }
}

export function copyAskBookingName(): string {
  return 'May I have the booking name, please?';
}

export function copyAskBookingPhone(): string {
  return 'May I have the best contact number for this booking?';
}

export function copyAskPreferredDate(): string {
  return 'What date would you prefer?';
}

export function copyAskPreferredTime(): string {
  return 'What time would you prefer? Morning, afternoon, or a specific time works.';
}

export function copyAskFirstVisit(): string {
  return 'Is this your first visit with us? You can skip this if you prefer.';
}

export function copyAskEmail(): string {
  return 'What email should we use for your booking?';
}

export function copyAskService(): string {
  return 'What service would you like to book?';
}

export function formatServiceAskWithOptionalMenu(menu?: string[]): string {
  if (!menu?.length) return copyAskService();
  const opts = expandBookingSelectOptions(menu);
  if (!opts.length) return copyAskService();
  const lines = opts.map((m, i) => {
    const prefix = i < 26 ? `${String.fromCharCode(65 + i)})` : `${i + 1})`;
    return `${prefix} ${m}`;
  });
  return `What service are you interested in?\n\n${lines.join('\n')}\n\nReply with a letter, pick from the list, or describe another service.`;
}

export function copyNeedDateForSlots(): string {
  return copyAskPreferredDate();
}

export function copySlotsOffered(dateYmd: string, lines: string[]): string {
  const body = lines.map((ln, i) => `${i + 1}. ${ln}`).join('\n');
  return `I found these available slots for ${dateYmd}:\n\n${body}\n\nWhich one would you like me to reserve?`;
}

export function copySlotsOfferedWithHumanDate(humanDate: string, lines: string[]): string {
  const body = lines.map((ln, i) => `${i + 1}. ${ln}`).join('\n');
  return `I found these available slots for ${humanDate}:\n\n${body}\n\nWhich one would you like me to reserve?`;
}

/** 24h HH:MM → en-US 12h label (deterministic, UTC wall clock for the time-of-day only). */
export function formatPreferredHmForDisplay(hm: string): string {
  const parts = hm.trim().split(':');
  const h = parseInt(parts[0] ?? '', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return hm.trim();
  const d = new Date(Date.UTC(2000, 0, 1, h, Number.isFinite(m) ? m : 0, 0));
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
}

export function copySlotsAroundRequestedTime(humanDate: string, requestedTimeLabel: string, lines: string[]): string {
  const body = lines.map((ln, i) => `${i + 1}. ${ln}`).join('\n');
  return `I found these available slots around ${requestedTimeLabel} for ${humanDate}:\n\n${body}\n\nWhich one would you like me to reserve?`;
}

export function copyClosestSlotsWhenPreferredUnavailable(
  humanDate: string,
  requestedTimeLabel: string,
  lines: string[],
): string {
  const body = lines.map((ln, i) => `${i + 1}. ${ln}`).join('\n');
  return `${requestedTimeLabel} isn't available for ${humanDate}. The closest options are:\n\n${body}\n\nWhich one would you like me to reserve?`;
}

export function copySingleExactTimeAvailable(humanDate: string, slotDisplay: string): string {
  return `${slotDisplay} is available for ${humanDate}.\n\nWould you like me to reserve it?\n\nReply 1 to confirm, or tell me another time you prefer.`;
}

export function copyNoSlotsInWindow(humanDate: string, windowLabel: string, lines: string[]): string {
  const body = lines.map((ln, i) => `${i + 1}. ${ln}`).join('\n');
  return `I checked the ${windowLabel} slots for ${humanDate}, but they're fully booked. The nearest available options are:\n\n${body}\n\nWhich one would you like me to reserve?`;
}

export function copyBookingConfirmed(dateYmd: string, slotDisplay: string, venueName: string): string {
  return `Done — your appointment is confirmed for ${dateYmd} at ${slotDisplay}.\n\nWe'll see you at ${venueName}.`;
}

export function copyFrustrationRecoveryContinue(): string {
  return "You're right, I've got that now. Let me continue from there.";
}

export function copyFrustrationRecoveryWithWindow(humanDate: string, windowLabel: string): string {
  return `You're right, I've got ${windowLabel}. Let me check the available slots for ${humanDate}.`;
}

export function copyRequiredFieldCannotSkip(): string {
  return "I'll need this detail to continue with the booking.";
}

export function copyPickSlotNumeric(): string {
  return copyPickSlotHelpSofter();
}

export function copyPickSlotHelpSofter(): string {
  return 'Please choose one of the listed times, or tell me another time you prefer.';
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripQuickOne(s: string): string {
  return collapseWhitespace(s.replace(/^\s*quick\s+one\s*:\s*/i, '').replace(/^\s*quick\s+one\s+/i, ''));
}

function dedupeQuestionMarks(s: string): string {
  let t = s.replace(/\?{2,}/g, '?').trim();
  if (t.endsWith('?')) return t;
  if (/^(do|may|is|are|what|which|when|how)\b/i.test(t)) return `${t}?`;
  return t;
}

function labelLooksLikeQuestion(label: string): boolean {
  const t = label.trim().toLowerCase();
  return /^(do|does|is|are|what|which|when|how|any|have\s+you)\b/.test(t);
}

function sentenceCaseFromLabel(label: string): string {
  const t = stripQuickOne(label).replace(/^[\s"'“”]+|[\s"'“”]+$/g, '').trim();
  if (!t) return 'Could you share one more detail for your booking?';
  const lower = t.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Polished booking prompt for a custom field (deterministic; no agency prompt).
 */
export function formatCustomFieldBookingQuestion(cf: CustomBookingFieldDto, optionalHint: boolean): string {
  const raw = stripQuickOne(cf.label);
  const base = dedupeQuestionMarks(raw.replace(/[.!…]+$/g, '').trim());
  const suffix = optionalHint ? ' You can skip this if you prefer.' : '';

  const flatOpts =
    (cf.fieldType === 'single_select' || cf.fieldType === 'single_choice') && cf.options?.length
      ? cf.options.flatMap(o =>
          o
            .split(',')
            .map(x => x.trim())
            .filter(Boolean),
        )
      : [];
  const opts = flatOpts.length ? `\n\nOptions: ${flatOpts.join(', ')}` : '';

  const cleaned = sentenceCaseFromLabel(base);
  if (/\bpreference\b/i.test(cleaned) || (/\bmale\b/i.test(cleaned) && /\bfemale\b/i.test(cleaned))) {
    return collapseWhitespace(`Do you have a preference for a male or female stylist?${suffix}${opts}`);
  }

  if (labelLooksLikeQuestion(base)) {
    return collapseWhitespace(dedupeQuestionMarks(sentenceCaseFromLabel(base))) + suffix + opts;
  }

  return collapseWhitespace(`May I have your ${cleaned}?${suffix}${opts}`);
}

export function copyClarifyName(): string {
  return 'May I have the booking name, please? A first name is fine.';
}

export function copyClarifyPhone(): string {
  return 'May I have the best contact number, with country code if you are outside your home country?';
}

export function copyClarifyEmail(): string {
  return 'Could you share a valid email address (for example name@example.com)?';
}

export function copyClarifyService(): string {
  return 'Which service would you like — for example colour, haircut, or treatment?';
}

export function copyClarifyPreferredDate(): string {
  return 'What date would you prefer? You can say 30 May, 30/5, today, or tomorrow.';
}

export function copyClarifyPreferredTime(): string {
  return 'What time suits you — morning, afternoon, or a specific time such as 2:30pm?';
}

export function copyClarifyFirstVisit(): string {
  return 'Is this your first visit with us? A quick yes or no is fine.';
}

export function copyClarifyCustomField(): string {
  return 'Could you answer that once more in a few words?';
}

/** After one rephrase, use for required fields (still not parseable). */
export function copyRequiredFieldPoliteFinal(fieldLabel?: string): string {
  if (fieldLabel?.trim()) {
    return collapseWhitespace(`I'll need ${fieldLabel.trim()} to continue with the booking.`);
  }
  return copyRequiredFieldCannotSkip();
}

const MO_FULL = [
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

/** "30 May" from YYYY-MM-DD (deterministic, no locale surprises). */
export function formatHumanDateFromYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd.trim();
  const day = parseInt(m[3]!, 10);
  const mo = parseInt(m[2]!, 10);
  const name = MO_FULL[mo - 1];
  return name ? `${day} ${name}` : ymd.trim();
}
