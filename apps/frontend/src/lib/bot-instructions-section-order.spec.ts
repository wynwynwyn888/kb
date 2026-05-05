import { describe, expect, it } from 'vitest';

/**
 * Expected major block order in `TenantGoalsPanel` (profile identity before knowledge access).
 * Update this test if the editor layout changes.
 */
const EXPECTED_MAJOR_SECTION_ORDER = [
  'profile_details',
  'persona',
  'conversation_goals',
  'business_notes',
  'knowledge_vaults',
  'advanced',
] as const;

describe('Bot Instructions editor section order', () => {
  it('lists Persona before Knowledge used by this assistant', () => {
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

  it('places Advanced after Knowledge', () => {
    expect(EXPECTED_MAJOR_SECTION_ORDER.indexOf('knowledge_vaults')).toBeLessThan(
      EXPECTED_MAJOR_SECTION_ORDER.indexOf('advanced'),
    );
  });
});
