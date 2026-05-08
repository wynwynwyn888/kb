import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(relFromApp: string): string {
  return readFileSync(join(process.cwd(), relFromApp), 'utf8');
}

describe('P0 UI/UX polish (handover readiness)', () => {
  it('Login page has premium copy and no demo/seed text', () => {
    const s = read('src/app/login/page.tsx');
    expect(s).toContain('Sign in to AISalesBot Pro');
    expect(s).toContain('Need access? Contact your workspace admin.');
    expect(s).not.toContain('Optional demo sign-in');
    expect(s).not.toContain('Demo123!');
    expect(s).not.toContain('seed demo data');
    expect(s).not.toContain('local evaluation only');
  });

  it('Internal placeholder routes are gated (agency-only)', () => {
    const pages = [
      'src/app/tester/page.tsx',
      'src/app/prompts/page.tsx',
      'src/app/conversations/page.tsx',
      'src/app/action-intents/page.tsx',
      'src/app/quotas/page.tsx',
    ];
    for (const p of pages) {
      const s = read(p);
      expect(s).toContain('AgencyOnlyGate');
    }
  });

  it('Assistant Preview hides provider/model details for normal workspace users', () => {
    const s = read('src/components/app/bot-test/BotTestPanel.tsx');
    expect(s).toContain("const showSupport = Boolean(user?.agencyRole)");
    expect(s).toContain('const meta = showSupport ? formatMetaLine(r) : undefined;');
    expect(s).not.toContain('🤖');
  });
});

