import { enabledAutoTagRulesForExecutor, type IntentTagRuleDto } from './intent-tags.service';

describe('enabledAutoTagRulesForExecutor', () => {
  it('returns only enabled AUTO rules with a tag name', () => {
    const rules: IntentTagRuleDto[] = [
      {
        intentKey: 'booking_interest',
        tagName: 'Book',
        enabled: true,
        triggerMode: 'AUTO',
      },
      {
        intentKey: 'price_question',
        tagName: '',
        enabled: true,
        triggerMode: 'AUTO',
      },
      {
        intentKey: 'hot_lead',
        tagName: 'Hot',
        enabled: false,
        triggerMode: 'AUTO',
      },
      {
        intentKey: 'colour_interest',
        tagName: 'Colour',
        enabled: true,
        triggerMode: 'OFF',
      },
    ];
    const auto = enabledAutoTagRulesForExecutor(rules);
    expect(auto.map((r) => r.intentKey)).toEqual(['booking_interest']);
  });
});
