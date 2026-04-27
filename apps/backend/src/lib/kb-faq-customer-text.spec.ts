import { polishKbSnippetForCustomer, tryPolishOpeningHoursLines } from './kb-faq-customer-text';

describe('kb-faq-customer-text', () => {
  it('rewrites weekday/weekend lines into one sentence', () => {
    const raw = 'Weekdays 9am-11pm\nWeekends 9am-12am';
    expect(tryPolishOpeningHoursLines(raw)).toBe(
      "We're open from 9am-11pm on weekdays, and 9am-12am on weekends.",
    );
    expect(polishKbSnippetForCustomer(raw)).toContain("We're open from");
  });

  it('handles slash-separated hours on one line', () => {
    const raw = 'Weekdays 9am-11pm / Weekends 9am-12am';
    expect(polishKbSnippetForCustomer(raw)).toMatch(/We're open from/i);
  });

  it('returns prose unchanged when no hours pattern', () => {
    const raw = 'We offer catering for events up to 200 guests.';
    expect(polishKbSnippetForCustomer(raw)).toBe(raw);
  });
});
