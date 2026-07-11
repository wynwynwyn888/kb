import { describe, expect, it } from '@jest/globals';
import {
  customSelectAnswerIsWholeOptionList,
  isAcceptedBookingServiceValue,
  isGenericBookingServicePhrase,
  resolveServiceFromBookingIntake,
  resolveServiceFromUserReplyLine,
} from './booking-service-intake';

describe('isGenericBookingServicePhrase', () => {
  it('treats common intent-only lines as generic', () => {
    expect(isGenericBookingServicePhrase('I want to book')).toBe(true);
    expect(isGenericBookingServicePhrase('want to book')).toBe(true);
    expect(isGenericBookingServicePhrase('booking')).toBe(true);
  });

  it('does not treat real service phrases as generic', () => {
    expect(isGenericBookingServicePhrase('haircut')).toBe(false);
    expect(isGenericBookingServicePhrase('Haircut')).toBe(false);
  });
});

describe('resolveServiceFromBookingIntake', () => {
  const menu = ['Haircut', 'Colour', 'Scalp Treatment'];

  it('A: does not fill from generic intent', () => {
    expect(resolveServiceFromBookingIntake('I want to book', 'I want to book', menu)).toBeUndefined();
    expect(resolveServiceFromBookingIntake('I want to book', 'I want to book', undefined)).toBeUndefined();
  });

  it('C: extracts haircut after intent when menu matches', () => {
    expect(resolveServiceFromBookingIntake('I want to book haircut', '', menu)).toBe('Haircut');
  });

  it('D: bare keyword maps to menu label', () => {
    expect(resolveServiceFromUserReplyLine('haircut', menu)).toBe('Haircut');
    expect(resolveServiceFromUserReplyLine('colour please', menu)).toBe('Colour');
  });

});

describe('isAcceptedBookingServiceValue', () => {
  const menu = ['Haircut', 'Colour'];

  it('rejects generic stored service', () => {
    expect(isAcceptedBookingServiceValue('I want to book', menu)).toBe(false);
    expect(isAcceptedBookingServiceValue('I want to book', undefined)).toBe(false);
  });

  it('accepts menu match', () => {
    expect(isAcceptedBookingServiceValue('Haircut', menu)).toBe(true);
    expect(isAcceptedBookingServiceValue('haircut', menu)).toBe(true);
  });
});

describe('customSelectAnswerIsWholeOptionList', () => {
  it('detects legacy full CSV option row as answer', () => {
    expect(customSelectAnswerIsWholeOptionList('Male,Female,Anything', ['Male,Female,Anything'])).toBe(true);
  });

  it('does not flag a single selection', () => {
    expect(customSelectAnswerIsWholeOptionList('Male', ['Male', 'Female', 'Anything'])).toBe(false);
  });
});
