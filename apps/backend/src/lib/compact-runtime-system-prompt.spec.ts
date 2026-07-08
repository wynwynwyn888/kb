import { describe, expect, it } from '@jest/globals';
import { PROMPT_FIELD_LIMITS } from '@aisbp/types';
import {
  compactProfileSections,
  buildCompactedPromptBody,
  budgetGlobalPolicy,
  compactPersonaPolicyForGeneration,
  estimateApproxTokens,
  RUNTIME_TENANT_SECTION_BUDGETS,
  RUNTIME_TENANT_SECTION_ORDER,
  GLOBAL_POLICY_RUNTIME_BUDGET,
} from './compact-runtime-system-prompt';

describe('runtime section budgets sourced from PROMPT_FIELD_LIMITS (no drift)', () => {
  it('tenant section budgets match the shared PROMPT_FIELD_LIMITS constant', () => {
    expect(RUNTIME_TENANT_SECTION_BUDGETS.criticalFacts).toBe(PROMPT_FIELD_LIMITS.criticalFacts);
    expect(RUNTIME_TENANT_SECTION_BUDGETS.persona).toBe(PROMPT_FIELD_LIMITS.persona);
    expect(RUNTIME_TENANT_SECTION_BUDGETS.goals).toBe(PROMPT_FIELD_LIMITS.conversationGoals);
    expect(RUNTIME_TENANT_SECTION_BUDGETS.businessNotes).toBe(PROMPT_FIELD_LIMITS.businessNotes);
    expect(RUNTIME_TENANT_SECTION_BUDGETS.salesPlaybook).toBe(PROMPT_FIELD_LIMITS.salesPlaybook);
    expect(RUNTIME_TENANT_SECTION_BUDGETS.bookingBehavior).toBe(PROMPT_FIELD_LIMITS.bookingBehavior);
    expect(RUNTIME_TENANT_SECTION_BUDGETS.escalationBehavior).toBe(PROMPT_FIELD_LIMITS.escalationBehavior);
  });

  it('total tenant section budget is 22,500 for the seven core fields', () => {
    const core =
      RUNTIME_TENANT_SECTION_BUDGETS.criticalFacts +
      RUNTIME_TENANT_SECTION_BUDGETS.persona +
      RUNTIME_TENANT_SECTION_BUDGETS.goals +
      RUNTIME_TENANT_SECTION_BUDGETS.businessNotes +
      RUNTIME_TENANT_SECTION_BUDGETS.salesPlaybook +
      RUNTIME_TENANT_SECTION_BUDGETS.bookingBehavior +
      RUNTIME_TENANT_SECTION_BUDGETS.escalationBehavior;
    expect(core).toBe(22500);
  });

  it('global policy budget is a separate, larger cap (10,000, not the legacy 7,500 tenant cap)', () => {
    expect(GLOBAL_POLICY_RUNTIME_BUDGET).toBe(10000);
    expect(GLOBAL_POLICY_RUNTIME_BUDGET).not.toBe(7500);
  });

  it('injection order is Critical Facts → Persona → Goals → Business Notes → Sales Playbook → Booking → Escalation', () => {
    expect(RUNTIME_TENANT_SECTION_ORDER.slice(0, 7)).toEqual([
      'criticalFacts', 'persona', 'goals', 'businessNotes', 'salesPlaybook', 'bookingBehavior', 'escalationBehavior',
    ]);
  });
});

describe('compactProfileSections', () => {
  it('persona preserved up to its 3,000 budget', () => {
    const result = compactProfileSections({ persona: 'A'.repeat(3000) });
    expect(result.sections.persona!.length).toBe(3000);
    expect(result.truncated.persona).toBeFalsy();
  });

  it('persona truncated only above 3,000', () => {
    const result = compactProfileSections({ persona: 'A'.repeat(3500) });
    expect(result.sections.persona!.length).toBeLessThanOrEqual(3010);
    expect(result.truncated.persona).toBe(true);
  });

  it('criticalFacts preserved up to 2,500 (no longer clipped at 1,500)', () => {
    const result = compactProfileSections({ criticalFacts: 'D'.repeat(2500) });
    expect(result.sections.criticalFacts!.length).toBe(2500);
    expect(result.truncated.criticalFacts).toBeFalsy();
  });

  it('conversationGoals preserved up to 5,000', () => {
    const result = compactProfileSections({ goals: 'B'.repeat(5000) });
    expect(result.sections.goals!.length).toBe(5000);
    expect(result.truncated.goals).toBeFalsy();
  });

  it('businessNotes truncated only above 5,000', () => {
    const result = compactProfileSections({ businessNotes: 'C'.repeat(6000) });
    expect(result.sections.businessNotes!.length).toBeLessThanOrEqual(5010);
    expect(result.truncated.businessNotes).toBe(true);
  });

  it('salesPlaybook truncated only above 3,000', () => {
    const result = compactProfileSections({ salesPlaybook: 'S'.repeat(3500) });
    expect(result.sections.salesPlaybook!.length).toBeLessThanOrEqual(3010);
    expect(result.truncated.salesPlaybook).toBe(true);
  });

  it('bookingBehavior and escalationBehavior each have a 2,000 budget', () => {
    const result = compactProfileSections({
      bookingBehavior: 'K'.repeat(2000),
      escalationBehavior: 'L'.repeat(2000),
    });
    expect(result.sections.bookingBehavior!.length).toBe(2000);
    expect(result.sections.escalationBehavior!.length).toBe(2000);
  });

  it('a large Business Notes section cannot truncate Critical Facts', () => {
    const result = compactProfileSections({
      criticalFacts: 'CF'.repeat(1000), // 2000 chars, under budget
      businessNotes: 'X'.repeat(9000),  // way over its own budget
    });
    // Critical Facts is untouched despite an oversized Business Notes.
    expect(result.sections.criticalFacts!.length).toBe(2000);
    expect(result.truncated.criticalFacts).toBeFalsy();
    expect(result.truncated.businessNotes).toBe(true);
  });

  it('each field is capped by its OWN budget, not a single combined tenant blob cap', () => {
    // Combined content is ~17k chars — far over the legacy 7,500 blob cap — yet every field
    // survives at its own budget.
    const result = compactProfileSections({
      criticalFacts: 'a'.repeat(2500),
      persona: 'b'.repeat(3000),
      goals: 'c'.repeat(5000),
      businessNotes: 'd'.repeat(5000),
      salesPlaybook: 's'.repeat(3000),
      bookingBehavior: 'e'.repeat(2000),
      escalationBehavior: 'f'.repeat(2000),
    });
    expect(result.sections.criticalFacts!.length).toBe(2500);
    expect(result.sections.persona!.length).toBe(3000);
    expect(result.sections.goals!.length).toBe(5000);
    expect(result.sections.businessNotes!.length).toBe(5000);
    expect(result.sections.salesPlaybook!.length).toBe(3000);
    expect(result.sections.bookingBehavior!.length).toBe(2000);
    expect(result.sections.escalationBehavior!.length).toBe(2000);
    expect(result.totalChars).toBeGreaterThan(7500);
  });

  it('empty sections are omitted', () => {
    const result = compactProfileSections({ persona: 'Hello', goals: '', businessNotes: '   ' });
    expect(result.sections.persona).toBe('Hello');
    expect(result.sections.goals).toBeUndefined();
    expect(result.sections.businessNotes).toBeUndefined();
  });

  it('all sections empty returns empty compacted', () => {
    const result = compactProfileSections({});
    expect(result.totalChars).toBe(0);
    expect(result.approxTokens).toBe(0);
  });
});

describe('buildCompactedPromptBody', () => {
  it('emits headers in canonical order', () => {
    const compacted = compactProfileSections({
      criticalFacts: 'Locked menu',
      persona: 'Friendly assistant',
      goals: 'Help customers book appointments',
      businessNotes: 'Hours 9-5',
      salesPlaybook: 'Qualify before CTA',
      bookingBehavior: 'Confirm the slot',
      escalationBehavior: 'Hand to human if angry',
    });
    const body = buildCompactedPromptBody(compacted);
    const order = ['### Critical facts', '### Bot Persona', '### Goals', '### Business notes', '### Sales playbook', '### Booking behavior', '### Escalation behavior'];
    let last = -1;
    for (const h of order) {
      const idx = body.indexOf(h);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it('omits sections that are empty', () => {
    const body = buildCompactedPromptBody(compactProfileSections({ persona: 'Hi' }));
    expect(body).not.toContain('### Critical facts');
    expect(body).not.toContain('### Goals');
  });
});

describe('budgetGlobalPolicy', () => {
  it('returns the global policy under its own 10,000 budget untruncated', () => {
    const r = budgetGlobalPolicy('G'.repeat(10000));
    expect(r.text.length).toBe(10000);
    expect(r.truncated).toBe(false);
  });

  it('truncates only above the global budget', () => {
    const r = budgetGlobalPolicy('G'.repeat(11000));
    expect(r.text.length).toBeLessThanOrEqual(10010);
    expect(r.truncated).toBe(true);
  });

  it('empty/undefined global policy yields empty text', () => {
    expect(budgetGlobalPolicy(undefined).text).toBe('');
    expect(budgetGlobalPolicy('   ').text).toBe('');
  });
});

describe('compactPersonaPolicyForGeneration (legacy fallback only)', () => {
  it('still works with tenant and agency prompts', () => {
    const result = compactPersonaPolicyForGeneration({
      tenantPrompt: 'Tenant instructions here',
      agencyPrompt: 'Agency policy here',
    });
    expect(result.tenantBody).toContain('Tenant');
    expect(result.agencyBody).toContain('Agency');
  });
});

describe('estimateApproxTokens', () => {
  it('returns 0 for 0 chars', () => {
    expect(estimateApproxTokens(0)).toBe(0);
  });
  it('returns chars/4 rounded up', () => {
    expect(estimateApproxTokens(100)).toBe(25);
    expect(estimateApproxTokens(1)).toBe(1);
  });
});
