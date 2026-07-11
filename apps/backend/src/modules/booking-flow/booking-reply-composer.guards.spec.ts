import { describe, expect, it } from '@jest/globals';
import { bookingReplyComposerOutputPassesGuardrails } from './booking-reply-composer.guards';

describe('bookingReplyComposerOutputPassesGuardrails', () => {
  it('offer_slots: rejects when reply adds more numbered rows than offered', () => {
    const nextStep = {
      type: 'offer_slots' as const,
      safeBaseMessage: 'Pick:\n\n1. Mon 9am\n2. Mon 10am',
      offeredSlots: [
        { option: 1, label: 'Mon 9am' },
        { option: 2, label: 'Mon 10am' },
      ],
    };
    const bad =
      'Pick:\n\n1. Mon 9am\n2. Mon 10am\n3. Tue 2pm (bonus)\n\nWhich works?';
    expect(bookingReplyComposerOutputPassesGuardrails(nextStep, nextStep.safeBaseMessage, bad)).toBe(false);
  });

  it('offer_slots: accepts reply that references offered labels', () => {
    const nextStep = {
      type: 'offer_slots' as const,
      safeBaseMessage: 'Slots:\n\n1. Mon 9am\n2. Mon 10am',
      offeredSlots: [
        { option: 1, label: 'Mon 9am' },
        { option: 2, label: 'Mon 10am' },
      ],
    };
    const ok = 'Here you go — 1) Mon 9am or 2) Mon 10am. Which one?';
    expect(bookingReplyComposerOutputPassesGuardrails(nextStep, nextStep.safeBaseMessage, ok)).toBe(true);
  });

  it('no_slots: rejects invented numbered slot list beyond safe base', () => {
    const safe = 'No openings that day — try another date.';
    const nextStep = { type: 'no_slots' as const, safeBaseMessage: safe };
    const bad = 'No openings that day.\n\n1. Mon 9am\n2. Mon 10am';
    expect(bookingReplyComposerOutputPassesGuardrails(nextStep, safe, bad)).toBe(false);
  });

  it('no_slots: rejects copy that claims found slots when base does not', () => {
    const safe = 'I could not find open slots for that date.';
    const nextStep = { type: 'no_slots' as const, safeBaseMessage: safe };
    const bad = 'I found these open slots for you: tomorrow 3pm.';
    expect(bookingReplyComposerOutputPassesGuardrails(nextStep, safe, bad)).toBe(false);
  });

  it('non-booking_confirmed: rejects appointment-confirmed wording', () => {
    const nextStep = { type: 'ask_name' as const, fieldId: 'name', safeBaseMessage: 'May I have your name?' };
    expect(
      bookingReplyComposerOutputPassesGuardrails(
        nextStep,
        nextStep.safeBaseMessage,
        'Done — your appointment is confirmed for Monday.',
      ),
    ).toBe(false);
  });

  it('booking_confirmed: allows confirmation phrasing', () => {
    const safe = 'Done — your appointment is confirmed for 1 May at 3pm.';
    const nextStep = { type: 'booking_confirmed' as const, safeBaseMessage: safe };
    expect(bookingReplyComposerOutputPassesGuardrails(nextStep, safe, safe)).toBe(true);
  });

  it('allows the customer language when the booking facts remain grounded', () => {
    const safe = 'For 19 June we have 2:00 PM available. Would you like me to book that time?';
    const nextStep = { type: 'offer_slots' as const, safeBaseMessage: safe, offeredSlots: [{ option: 1, label: '2:00 PM' }] };
    const pt = 'Para o dia 19 de junho, temos 2:00 PM disponível. Você gostaria que eu reservasse esse horário?';
    expect(bookingReplyComposerOutputPassesGuardrails(nextStep, safe, pt)).toBe(true);
  });

});
