import { describe, expect, it } from '@jest/globals';
import {
  extractPreferredTime,
  extractPreferredTimeWindow,
  extractServiceFromBookingMessage,
  filterFreeSlotsByTimeWindow,
  parseFirstVisitNaturalReply,
  parsePlainNameAnswerLine,
  parseSlotSelection,
  resolveBookingCalendarDay,
  resolveRelativeDayPhrase,
  stripBookingFrustrationForParse,
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
