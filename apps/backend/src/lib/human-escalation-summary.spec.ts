import { buildReadableFallbackInternalSummary } from './human-escalation-summary';

describe('buildReadableFallbackInternalSummary', () => {
  it('produces a readable sentence instead of raw joined lines', () => {
    const s = buildReadableFallbackInternalSummary('I want to speak to a human', [
      { role: 'user', content: 'Hi', sender: 'CONTACT', timestamp: 't1', messageType: 'text' },
      { role: 'assistant', content: 'Hello', sender: 'AI', timestamp: 't2', messageType: 'text' },
      { role: 'user', content: 'Can I see the menu?', sender: 'CONTACT', timestamp: 't3', messageType: 'text' },
    ]);
    expect(s).toMatch(/requested human assistance/i);
    expect(s).not.toMatch(/Hi ·/);
    expect(s).not.toMatch(/menu pls/i);
  });

  it('mentions menu context when detected', () => {
    const s = buildReadableFallbackInternalSummary('Human please', [
      { role: 'user', content: 'What is on the food menu?', sender: 'CONTACT', timestamp: 't1', messageType: 'text' },
    ]);
    expect(s.toLowerCase()).toContain('menu');
  });
});
