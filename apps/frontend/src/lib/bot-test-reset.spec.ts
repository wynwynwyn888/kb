import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

describe('Bot Test reset behavior', () => {
  it('handles /new locally instead of generating an automatic reply', () => {
    const t = read('src/components/app/bot-test/BotTestPanel.tsx');
    expect(t).toContain('BOT_TEST_RESET_COMMAND_RE');
    expect(t).toContain('setMsgs([]);');
    expect(t).toContain('return;');
  });

  it('uses theme text color for the input so dark mode remains readable', () => {
    const t = read('src/components/app/bot-test/BotTestPanel.tsx');
    expect(t).toContain('.aisbp-bot-test-input{color:var(--aisbp-text,#0f172a)}');
    expect(t).toContain('@media (prefers-color-scheme: dark){.aisbp-bot-test-input{color:var(--aisbp-text,#f8fafc)}}');
  });
});
