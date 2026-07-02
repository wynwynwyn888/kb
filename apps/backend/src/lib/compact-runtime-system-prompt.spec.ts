import { describe, expect, it } from '@jest/globals';
import {
  compactProfileSections,
  buildCompactedPromptBody,
  compactPersonaPolicyForGeneration,
  estimateApproxTokens,
} from './compact-runtime-system-prompt';

describe('compactProfileSections', () => {
  it('persona truncated at 1,500', () => {
    const long = 'A'.repeat(2000);
    const result = compactProfileSections({ persona: long });
    expect(result.sections.persona!.length).toBeLessThanOrEqual(1510);
    expect(result.truncated.persona).toBe(true);
  });

  it('persona under 1,500 not truncated', () => {
    const result = compactProfileSections({ persona: 'Short persona' });
    expect(result.sections.persona).toBe('Short persona');
    expect(result.truncated.persona).toBeFalsy();
  });

  it('goals truncated at 5,000', () => {
    const long = 'B'.repeat(6000);
    const result = compactProfileSections({ goals: long });
    expect(result.sections.goals!.length).toBeLessThanOrEqual(5020);
    expect(result.truncated.goals).toBe(true);
  });

  it('businessNotes truncated at 5,000', () => {
    const long = 'C'.repeat(6000);
    const result = compactProfileSections({ businessNotes: long });
    expect(result.sections.businessNotes!.length).toBeLessThanOrEqual(5020);
    expect(result.truncated.businessNotes).toBe(true);
  });

  it('criticalFacts truncated at 1,500 as safety net', () => {
    const long = 'D'.repeat(2000);
    const result = compactProfileSections({ criticalFacts: long });
    expect(result.sections.criticalFacts!.length).toBeLessThanOrEqual(1510);
    expect(result.truncated.criticalFacts).toBe(true);
  });

  it('criticalFacts under 1,500 not truncated', () => {
    const result = compactProfileSections({ criticalFacts: 'Prices: $50-200' });
    expect(result.sections.criticalFacts).toBe('Prices: $50-200');
    expect(result.truncated.criticalFacts).toBeFalsy();
  });

  it('long persona does not consume goals budget', () => {
    const result = compactProfileSections({
      persona: 'A'.repeat(2000),
      goals: 'Our goal is to help',
    });
    expect(result.sections.persona!.length).toBeLessThanOrEqual(1510);
    expect(result.sections.goals).toBe('Our goal is to help');
    expect(result.truncated.persona).toBe(true);
    expect(result.truncated.goals).toBeFalsy();
  });

  it('businessNotes preserved even when persona is long', () => {
    const result = compactProfileSections({
      persona: 'A'.repeat(2000),
      businessNotes: 'Important business info here',
    });
    expect(result.sections.businessNotes).toBe('Important business info here');
  });

  it('agency truncated at 4,000', () => {
    const long = 'E'.repeat(5000);
    const result = compactProfileSections({ agency: long });
    expect(result.sections.agency!.length).toBeLessThanOrEqual(4015);
    expect(result.truncated.agency).toBe(true);
  });

  it('empty sections are omitted', () => {
    const result = compactProfileSections({
      persona: 'Hello',
      goals: '',
      businessNotes: '   ',
    });
    expect(result.sections.persona).toBe('Hello');
    expect(result.sections.goals).toBeUndefined();
    expect(result.sections.businessNotes).toBeUndefined();
  });

  it('totalChars and approxTokens are computed', () => {
    const result = compactProfileSections({
      persona: 'Hello',
      goals: 'Sell more',
    });
    expect(result.totalChars).toBeGreaterThan(0);
    expect(result.approxTokens).toBeGreaterThan(0);
  });

  it('all sections empty returns empty compacted', () => {
    const result = compactProfileSections({});
    expect(result.totalChars).toBe(0);
    expect(result.approxTokens).toBe(0);
  });
});

describe('buildCompactedPromptBody', () => {
  it('includes section headers for non-empty sections', () => {
    const compacted = compactProfileSections({
      persona: 'Friendly assistant',
      goals: 'Help customers book appointments',
    });
    const body = buildCompactedPromptBody(compacted);
    expect(body).toContain('### Bot Persona');
    expect(body).toContain('Friendly assistant');
    expect(body).toContain('### Goals');
    expect(body).toContain('Help customers book appointments');
  });

  it('includes Critical facts header for criticalFacts', () => {
    const compacted = compactProfileSections({
      criticalFacts: 'Prices: $50-200',
    });
    const body = buildCompactedPromptBody(compacted);
    expect(body).toContain('### Critical facts');
    expect(body).toContain('Prices: $50-200');
  });

  it('omits sections that are empty', () => {
    const compacted = compactProfileSections({ persona: 'Hi' });
    const body = buildCompactedPromptBody(compacted);
    expect(body).not.toContain('### Critical facts');
    expect(body).not.toContain('### Goals');
  });
});

describe('compactPersonaPolicyForGeneration (legacy)', () => {
  it('still works with tenant and agency prompts', () => {
    const result = compactPersonaPolicyForGeneration({
      tenantPrompt: 'Tenant instructions here',
      agencyPrompt: 'Agency policy here',
    });
    expect(result.tenantBody).toContain('Tenant');
    expect(result.agencyBody).toContain('Agency');
    expect(result.tenantTruncated).toBe(false);
    expect(result.agencyTruncated).toBe(false);
  });

  it('truncates long prompts', () => {
    const long = 'X'.repeat(8000);
    const result = compactPersonaPolicyForGeneration({
      tenantPrompt: long,
      agencyPrompt: '',
      tenantCap: 2000,
    });
    expect(result.tenantBody.length).toBeLessThanOrEqual(2020);
    expect(result.tenantTruncated).toBe(true);
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
