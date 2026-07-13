import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PANEL_SOURCE = readFileSync(
  new URL('../components/app/tenant-workspace/TenantGoalsPanel.tsx', import.meta.url),
  'utf8',
);

/**
 * Expected major block order in `TenantGoalsPanel` (profile identity before knowledge access).
 * Update this test if the editor layout changes.
 */
const EXPECTED_MAJOR_SECTION_ORDER = [
  'profile_details',
  'critical_facts',
  'sales_playbook',
  'persona',
  'conversation_goals',
  'business_notes',
  'knowledge_vaults',
  'advanced',
] as const;

describe('Bot Instructions editor section order', () => {
  it('lists Persona before Knowledge used by this AI Agent', () => {
    const pi = EXPECTED_MAJOR_SECTION_ORDER.indexOf('persona');
    const ki = EXPECTED_MAJOR_SECTION_ORDER.indexOf('knowledge_vaults');
    expect(pi).toBeGreaterThanOrEqual(0);
    expect(ki).toBeGreaterThanOrEqual(0);
    expect(pi).toBeLessThan(ki);
  });

  it('places Business notes before Knowledge', () => {
    expect(EXPECTED_MAJOR_SECTION_ORDER.indexOf('business_notes')).toBeLessThan(
      EXPECTED_MAJOR_SECTION_ORDER.indexOf('knowledge_vaults'),
    );
  });

  it('places Sales Playbook immediately after Critical Facts', () => {
    expect(EXPECTED_MAJOR_SECTION_ORDER.indexOf('sales_playbook')).toBe(
      EXPECTED_MAJOR_SECTION_ORDER.indexOf('critical_facts') + 1,
    );

    const criticalFactsCard = PANEL_SOURCE.indexOf(
      '<h3 style={sectionTitleStyle}>Critical Facts</h3>',
    );
    const salesPlaybookCard = PANEL_SOURCE.indexOf(
      '<h3 style={sectionTitleStyle}>Sales Playbook</h3>',
    );
    const personaCard = PANEL_SOURCE.indexOf('<h3 style={sectionTitleStyle}>Persona</h3>');
    expect(criticalFactsCard).toBeGreaterThanOrEqual(0);
    expect(salesPlaybookCard).toBeGreaterThan(criticalFactsCard);
    expect(personaCard).toBeGreaterThan(salesPlaybookCard);

    const criticalFactsTab = PANEL_SOURCE.indexOf("{ key: 'criticalFacts', label: 'Critical Facts'");
    const salesPlaybookTab = PANEL_SOURCE.indexOf("{ key: 'salesPlaybook', label: 'Sales Playbook'");
    const personaTab = PANEL_SOURCE.indexOf("{ key: 'persona', label: 'Persona'");
    expect(criticalFactsTab).toBeGreaterThanOrEqual(0);
    expect(salesPlaybookTab).toBeGreaterThan(criticalFactsTab);
    expect(personaTab).toBeGreaterThan(salesPlaybookTab);
  });

  it('places Advanced after Knowledge', () => {
    expect(EXPECTED_MAJOR_SECTION_ORDER.indexOf('knowledge_vaults')).toBeLessThan(
      EXPECTED_MAJOR_SECTION_ORDER.indexOf('advanced'),
    );
  });
});
