import { userRequestsFormattingPreference } from './formatting-preference-intent';

describe('userRequestsFormattingPreference', () => {
  it('detects informal bold-output asks', () => {
    expect(userRequestsFormattingPreference('can u bold output')).toBe(true);
    expect(userRequestsFormattingPreference('Can you bold the important bits?')).toBe(true);
  });

  it('detects bullet / point-form / shorter asks', () => {
    expect(userRequestsFormattingPreference('reply in point form')).toBe(true);
    expect(userRequestsFormattingPreference('use bullet points please')).toBe(true);
    expect(userRequestsFormattingPreference('make it shorter')).toBe(true);
    expect(userRequestsFormattingPreference('split into shorter messages')).toBe(true);
  });

  it('does not flag unrelated product questions', () => {
    expect(userRequestsFormattingPreference('how much is a haircut')).toBe(false);
  });
});
