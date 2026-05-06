import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

describe('assistant workspace scope copy', () => {
  it('assistant overview does not claim automation is profile-scoped', () => {
    const t = read('src/components/app/tenant-workspace/TenantAssistantOverview.tsx');
    expect(t).not.toContain('These rules are saved to this assistant profile');
    expect(t).toContain('Automation rules currently apply at workspace');
  });

  it('assistant preview mentions workspace automation rules', () => {
    const t = read('src/components/app/bot-test/BotTestPanel.tsx');
    expect(t).toContain("this workspace's automation rules");
  });

  it('automation header mentions workspace scope', () => {
    const t = read('src/components/app/tenant-workspace/AutomationWorkspaceLayout.tsx');
    expect(t).toContain('Automation currently applies across this workspace');
  });

  it('tag automation tab clarifies workspace scope', () => {
    const t = read('src/components/app/tenant-workspace/automation/AutomationTagsPanel.tsx');
    expect(t).toContain('Tag rules currently apply across this workspace');
  });
});

