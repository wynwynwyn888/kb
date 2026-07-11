import type { BookingReplyComposerNextStep } from './booking-reply-composer.types';
const CONFIRM_PATTERNS =
  /\b(appointment\s+is\s+confirmed|done\s*[—–-]\s*your\s+appointment|you\s*['']?re\s+all\s+set|booking\s+is\s+confirmed)\b/i;

/** Lightweight checks so the model cannot invent confirmations or extra slot rows. */
export function bookingReplyComposerOutputPassesGuardrails(
  nextStep: BookingReplyComposerNextStep,
  safeBaseMessage: string,
  reply: string,
): boolean {
  const r = reply.trim();
  if (!r || r.length > 2200) return false;

  if (nextStep.type !== 'booking_confirmed' && CONFIRM_PATTERNS.test(r)) {
    return false;
  }

  if (nextStep.type === 'no_slots') {
    const numberedReply = (r.match(/(?:^|\n)\d+\.\s+/gm) ?? []).length;
    const numberedSafe = (safeBaseMessage.match(/(?:^|\n)\d+\.\s+/gm) ?? []).length;
    if (numberedReply > numberedSafe) return false;
    if (/\b(i\s+found|here\s+are)\s+.*\b(open\s+)?slots\b/i.test(r) && !/\b(i\s+found|here\s+are)\b/i.test(safeBaseMessage)) {
      return false;
    }
  }

  if (nextStep.type === 'offer_slots' && nextStep.offeredSlots?.length) {
    const nOffered = nextStep.offeredSlots.length;
    const nNumbered = (r.match(/(?:^|\n)\d+\.\s+/gm) ?? []).length;
    if (nNumbered > nOffered) return false;
    const labels = nextStep.offeredSlots.map(s => s.label.trim()).filter(Boolean);
    const lower = r.toLowerCase();
    let hits = 0;
    for (const lbl of labels) {
      if (lbl.length >= 3 && lower.includes(lbl.toLowerCase())) hits += 1;
    }
    if (hits < Math.min(labels.length, Math.max(1, Math.ceil(labels.length * 0.66)))) {
      return false;
    }
  }

  return true;
}
