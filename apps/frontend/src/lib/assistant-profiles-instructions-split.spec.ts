import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

describe('assistant profiles vs instructions surfaces', () => {
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
    expect(t).toContain('Set live');
    expect(t).toContain('Duplicate');
    expect(t).toContain('Delete');
  });

  it('instructions surface includes active editing label and switch profile link', () => {
    const t = read('src/components/app/tenant-workspace/TenantGoalsPanel.tsx');
    expect(t).toContain('Editing:');
    expect(t).toContain('Switch profile →');
    expect(t).toContain('Persona');
    expect(t).toContain('Conversation goals');
    expect(t).toContain('Business notes');
    expect(t).toContain('Knowledge used by this assistant');
  });
});

