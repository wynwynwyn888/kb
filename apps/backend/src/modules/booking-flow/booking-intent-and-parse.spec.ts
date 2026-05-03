import { describe, expect, it } from '@jest/globals';
import {
  addCalendarDaysUtcYmd,
  extractPreferredTime,
  extractPreferredTimeWindow,
  extractServiceFromBookingMessage,
  filterFreeSlotsByTimeWindow,
  parseExactSlotReservationAffirmative,
  parseFirstVisitNaturalReply,
  parsePlainNameAnswerLine,
  parseSlotSelection,
  parseSlotSelectionOrTimeRevision,
  rankSlotsForBookingOffer,
  resolveBookingCalendarDay,
  resolveRelativeDayPhrase,
  shouldSuppressImplicitSlotPickFromFrustration,
  stripBookingFrustrationForParse,
  userCombinedMessageAskedAvailabilityQuestion,
} from './booking-intent-and-parse';

describe('parseSlotSelection', () => {
  const offered = [
    { option: 1, displayText: '10:00 AM', startIso: '2026-05-10T10:00:00.000Z' },
    { option: 2, displayText: '10:30 AM', startIso: '2026-05-10T10:30:00.000Z' },
    { option: 3, displayText: '11:00 AM', startIso: '2026-05-10T11:00:00.000Z' },
  ];

  it('maps "2" to second slot', () => {
    expect(parseSlotSelection('2', offered)).toEqual({ kind: 'option', option: 2 });
  });

  it('parses "2 pm" as a time, not option 2', () => {
    expect(parseSlotSelection('2 pm can?', offered)).toEqual({ kind: 'time', normalizedHm: '14:00' });
  });
});

describe('extractServiceFromBookingMessage', () => {
  it('parses service before on-date phrase', () => {
    const t = 'I want to book hair colour on 21 May around 9am';
    expect(extractServiceFromBookingMessage(t)).toBe('hair colour');
  });
});

describe('resolveBookingCalendarDay', () => {
  it('parses 21 May with implied year from reference', () => {
    expect(resolveBookingCalendarDay('on 21 May around 9am', '2026-05-01')).toBe('2026-05-21');
  });

  it('parses day-first 30/5 as upcoming May 30', () => {
    expect(resolveBookingCalendarDay('30/5 morning', '2026-05-01')).toBe('2026-05-30');
    expect(resolveBookingCalendarDay('i want booking on 30/5 can?', '2026-05-01')).toBe('2026-05-30');
  });

  it('rolls to next year when day-month is in the past', () => {
    expect(resolveBookingCalendarDay('21 May', '2026-06-01')).toBe('2027-05-21');
  });
});

describe('resolveRelativeDayPhrase', () => {
  it('parses this Friday and next Friday from a fixed Wednesday', () => {
    expect(resolveRelativeDayPhrase('this Friday', '2026-05-20')).toBe('2026-05-22');
    expect(resolveRelativeDayPhrase('next Friday', '2026-05-20')).toBe('2026-05-29');
  });
});

describe('extractPreferredTime', () => {
  it('parses dotted pm, around, and trailing filler', () => {
    expect(extractPreferredTime('2.30pm')).toBe('14:30');
    expect(extractPreferredTime('around 10')).toBe('10:00');
    expect(extractPreferredTime('around 10am')).toBe('10:00');
    expect(extractPreferredTime('10am man')).toBe('10:00');
  });
});

describe('extractPreferredTimeWindow', () => {
  it('detects broad windows', () => {
    expect(extractPreferredTimeWindow('morning please')).toBe('morning');
    expect(extractPreferredTimeWindow('after work')).toBe('after_work');
    expect(extractPreferredTimeWindow('before lunch')).toBe('before_lunch');
  });
});

describe('parseExactSlotReservationAffirmative', () => {
  it('accepts yes and book phrasing', () => {
    expect(parseExactSlotReservationAffirmative('yes')).toBe(true);
    expect(parseExactSlotReservationAffirmative('please reserve')).toBe(true);
    expect(parseExactSlotReservationAffirmative('can')).toBe(true);
  });
});

describe('shouldSuppressImplicitSlotPickFromFrustration', () => {
  it('detects why-still-ask complaints', () => {
    expect(shouldSuppressImplicitSlotPickFromFrustration('i said 9am, why u still ask me?')).toBe(true);
    expect(shouldSuppressImplicitSlotPickFromFrustration('why do you still ask')).toBe(true);
  });
});

describe('userCombinedMessageAskedAvailabilityQuestion', () => {
  it('detects timing availability questions', () => {
    expect(userCombinedMessageAskedAvailabilityQuestion('is this timing available?')).toBe(true);
  });
});

describe('stripBookingFrustrationForParse', () => {
  it('strips frustration but leaves parseable time words', () => {
    const r = stripBookingFrustrationForParse('i told you morning right');
    expect(r.hadFrustration).toBe(true);
    expect(r.cleaned.toLowerCase()).toContain('morning');
  });
});

describe('filterFreeSlotsByTimeWindow', () => {
  it('keeps only morning-local starts in UTC morning window', () => {
    const slots = [
      { startTime: '2026-05-10T09:00:00.000Z' },
      { startTime: '2026-05-10T14:00:00.000Z' },
    ];
    const f = filterFreeSlotsByTimeWindow(slots, 'morning', 'UTC');
    expect(f.map(s => s.startTime)).toEqual(['2026-05-10T09:00:00.000Z']);
  });
});

describe('parsePlainNameAnswerLine', () => {
  it('accepts single first name', () => {
    expect(parsePlainNameAnswerLine('Lucy')).toBe('Lucy');
  });

  it('strips frustrated preamble', () => {
    expect(parsePlainNameAnswerLine('i told u Lucy')).toBe('Lucy');
  });
});

describe('parseFirstVisitNaturalReply', () => {
  it('treats polite first-visit phrases as yes', () => {
    expect(parseFirstVisitNaturalReply('yes first visit dear')).toBe('yes');
    expect(parseFirstVisitNaturalReply('YES, first visit — thanks!')).toBe('yes');
    expect(parseFirstVisitNaturalReply('this is my first visit')).toBe('yes');
    expect(parseFirstVisitNaturalReply('new customer here please')).toBe('yes');
  });

  it('treats returning / negated phrases as no', () => {
    expect(parseFirstVisitNaturalReply('not my first visit')).toBe('no');
    expect(parseFirstVisitNaturalReply('returning customer')).toBe('no');
    expect(parseFirstVisitNaturalReply('been before, thanks')).toBe('no');
  });

  it('accepts bare yes/no after normalization', () => {
    expect(parseFirstVisitNaturalReply('yes')).toBe('yes');
    expect(parseFirstVisitNaturalReply('no')).toBe('no');
    expect(parseFirstVisitNaturalReply('nope')).toBe('no');
  });
});

describe('parseSlotSelectionOrTimeRevision', () => {
  const offered = [
    { option: 1, displayText: '12:00 PM', startIso: '2026-05-10T12:00:00.000Z' },
    { option: 2, displayText: '12:30 PM', startIso: '2026-05-10T12:30:00.000Z' },
    { option: 3, displayText: '1:00 PM', startIso: '2026-05-10T13:00:00.000Z' },
  ];

  it('returns time_revision when 2pm is not in the offer list', () => {
    const r = parseSlotSelectionOrTimeRevision('2pm can?', '', offered, 'UTC', '2026-05-10', '2026-05-01');
    expect(r).toEqual({ kind: 'time_revision', preferredTime: '14:00' });
  });

  it('returns selected_slot for numeric 3', () => {
    const r = parseSlotSelectionOrTimeRevision('3', '', offered, 'UTC', '2026-05-10', '2026-05-01');
    expect(r.kind).toBe('selected_slot');
    if (r.kind === 'selected_slot') expect(r.slot.option).toBe(3);
  });

  it('returns date_time_revision for tomorrow 2pm', () => {
    const r = parseSlotSelectionOrTimeRevision('tomorrow 2pm', '', offered, 'UTC', '2026-05-10', '2026-05-01');
    expect(r.kind).toBe('date_time_revision');
    if (r.kind === 'date_time_revision') {
      expect(r.preferredDate).toBe('2026-05-02');
      expect(r.preferredTime).toBe('14:00');
    }
  });

  it('A: combined has 3pm but latest is bare "3" => option 3, not 3pm from thread', () => {
    const threePmOffered = [
      { option: 1, displayText: '3:00 PM', startIso: '2026-05-10T15:00:00.000Z' },
      { option: 2, displayText: '3:30 PM', startIso: '2026-05-10T15:30:00.000Z' },
      { option: 3, displayText: '4:00 PM', startIso: '2026-05-10T16:00:00.000Z' },
    ];
    const combined = 'I want 3pm if possible';
    const r = parseSlotSelectionOrTimeRevision('3', combined, threePmOffered, 'UTC', '2026-05-10', '2026-05-01');
    expect(r.kind).toBe('selected_slot');
    if (r.kind === 'selected_slot') {
      expect(r.slot.option).toBe(3);
      expect(r.slot.startIso).toBe('2026-05-10T16:00:00.000Z');
    }
  });

  it('B: combined has 3pm; latest "told you 3pm" => time match or revision to 15:00 (not bare index)', () => {
    const threePmOffered = [
      { option: 1, displayText: '3:00 PM', startIso: '2026-05-10T15:00:00.000Z' },
      { option: 2, displayText: '3:30 PM', startIso: '2026-05-10T15:30:00.000Z' },
      { option: 3, displayText: '4:00 PM', startIso: '2026-05-10T16:00:00.000Z' },
    ];
    const r = parseSlotSelectionOrTimeRevision('told you 3pm', 'earlier 3pm', threePmOffered, 'UTC', '2026-05-10', '2026-05-01');
    expect(r.kind).toBe('selected_slot');
    if (r.kind === 'selected_slot') expect(r.slot.option).toBe(1);
  });

  it('C: combined has 2pm; latest bare "2" => option 2, not 14:00 revision', () => {
    const offered = [
      { option: 1, displayText: '12:00 PM', startIso: '2026-05-10T12:00:00.000Z' },
      { option: 2, displayText: '12:30 PM', startIso: '2026-05-10T12:30:00.000Z' },
      { option: 3, displayText: '1:00 PM', startIso: '2026-05-10T13:00:00.000Z' },
    ];
    const r = parseSlotSelectionOrTimeRevision('2', 'I said 2pm earlier', offered, 'UTC', '2026-05-10', '2026-05-01');
    expect(r.kind).toBe('selected_slot');
    if (r.kind === 'selected_slot') expect(r.slot.option).toBe(2);
  });

  it('D: latest "2pm can?" => time_revision, not option 2', () => {
    const offered = [
      { option: 1, displayText: '12:00 PM', startIso: '2026-05-10T12:00:00.000Z' },
      { option: 2, displayText: '12:30 PM', startIso: '2026-05-10T12:30:00.000Z' },
      { option: 3, displayText: '1:00 PM', startIso: '2026-05-10T13:00:00.000Z' },
    ];
    const r = parseSlotSelectionOrTimeRevision('2pm can?', '2pm', offered, 'UTC', '2026-05-10', '2026-05-01');
    expect(r).toEqual({ kind: 'time_revision', preferredTime: '14:00' });
  });
});

describe('rankSlotsForBookingOffer', () => {
  it('orders exact preferred time first then closest', () => {
    const slots = [
      { startTime: '2026-05-10T13:00:00.000Z' },
      { startTime: '2026-05-10T14:30:00.000Z' },
      { startTime: '2026-05-10T14:00:00.000Z' },
    ];
    const { ranked, hasExactPreferredTimeMatch } = rankSlotsForBookingOffer(slots, {
      preferredHm: '14:00',
      crmTimeZone: 'UTC',
      max: 3,
    });
    expect(hasExactPreferredTimeMatch).toBe(true);
    expect(ranked[0]!.startTime).toBe('2026-05-10T14:00:00.000Z');
  });
});

describe('addCalendarDaysUtcYmd', () => {
  it('adds days across month boundary', () => {
    expect(addCalendarDaysUtcYmd('2026-05-29', 14)).toBe('2026-06-12');
  });
});
