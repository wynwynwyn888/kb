import { enabledAutoTagRulesForExecutor, type TagRuleDto } from './tag-rules.service';

describe('enabledAutoTagRulesForExecutor', () => {
  it('returns only enabled rules with autoApply and CRM tag name', () => {
    const rules: TagRuleDto[] = [
      {
        id: 'a',
        tenantId: 't',
        enabled: true,
        autoApply: true,
        ruleName: 'Book',
        ruleDescription: 'desc',
        keywords: [],
        crmTagId: null,
        crmTagName: 'book_tag',
        matchMode: 'AI',
        confidenceThreshold: 'NORMAL',
        priority: 0,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'b',
        tenantId: 't',
        enabled: true,
        autoApply: true,
        ruleName: 'Price',
        ruleDescription: 'desc',
        keywords: [],
        crmTagId: null,
        crmTagName: '',
        matchMode: 'KEYWORD',
        confidenceThreshold: 'NORMAL',
        priority: 0,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'c',
        tenantId: 't',
        enabled: false,
        autoApply: true,
        ruleName: 'Hot',
        ruleDescription: 'desc',
        keywords: [],
        crmTagId: null,
        crmTagName: 'hot',
        matchMode: 'AI',
        confidenceThreshold: 'NORMAL',
        priority: 0,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'd',
        tenantId: 't',
        enabled: true,
        autoApply: false,
        ruleName: 'Colour',
        ruleDescription: 'desc',
        keywords: [],
        crmTagId: null,
        crmTagName: 'colour',
        matchMode: 'AI',
        confidenceThreshold: 'NORMAL',
        priority: 0,
        createdAt: '',
        updatedAt: '',
      },
    ];
    const auto = enabledAutoTagRulesForExecutor(rules);
    expect(auto.map((r) => r.id)).toEqual(['a']);
  });
});
