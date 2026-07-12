import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { PROMPT_FIELD_LIMITS } from '@aisbp/types';

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

describe('assistant profiles vs instructions surfaces', () => {
  it('allows 5,000 Sales Playbook characters in the shared frontend limit', () => {
    expect(PROMPT_FIELD_LIMITS.salesPlaybook).toBe(5000);
  });
  it('profiles route renders in profiles mode', () => {
    const t = read('src/app/app/tenant/[tenantId]/assistant/profiles/page.tsx');
    expect(t).toContain('mode="profiles"');
  });

  it('instructions route renders in instructions mode', () => {
    const t = read('src/app/app/tenant/[tenantId]/assistant/instructions/page.tsx');
    expect(t).toContain('mode="instructions"');
  });

  it('profile management UI includes expected actions', () => {
    const t = read('src/components/app/tenant-workspace/TenantGoalsPanel.tsx');
    expect(t).toContain('Edit instructions');
    expect(t).toContain('Set active');
    expect(t).toContain('Duplicate');
    expect(t).toContain('Delete');
  });

  it('profiles UX uses a primary set-live and safe modals', () => {
    const t = read('src/components/app/tenant-workspace/TenantGoalsPanel.tsx');
    expect(t).toContain('data-action="set-active"');
    expect(t).toContain('data-variant="primary"');
    expect(t).toContain('Delete AI Agent profile?');
    expect(t).toContain('Type “delete” to confirm');
    expect(t).toContain('Create AI Agent profile');
    expect(t).toContain('aria-label="Create profile"');
  });

  it('instructions surface includes active editing label and switch profile link', () => {
    const t = read('src/components/app/tenant-workspace/TenantGoalsPanel.tsx');
    expect(t).toContain('Editing:');
    expect(t).toContain('Switch profile →');
    expect(t).toContain('Persona');
    expect(t).toContain('Conversation goals');
    expect(t).toContain('Business notes');
    expect(t).toContain('Sales Playbook');
    expect(t).toContain('Knowledge used by this AI Agent');
  });
});
