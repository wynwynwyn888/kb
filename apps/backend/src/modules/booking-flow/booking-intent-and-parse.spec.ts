import { describe, expect, it } from '@jest/globals';
import {
  extractServiceFromBookingMessage,
  parseFirstVisitNaturalReply,
  parsePlainNameAnswerLine,
  parseSlotSelection,
  resolveBookingCalendarDay,
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

  it('rolls to next year when day-month is in the past', () => {
    expect(resolveBookingCalendarDay('21 May', '2026-06-01')).toBe('2027-05-21');
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
