import { buildDeterministicHumanEscalationSummary } from './human-escalation-summary';

describe('buildDeterministicHumanEscalationSummary', () => {
  it('joins recent inbound lines with the latest message', () => {
    const s = buildDeterministicHumanEscalationSummary('I need a human', [
      { role: 'user', content: 'Hi', sender: 'CONTACT', timestamp: 't1', messageType: 'text' },
      { role: 'assistant', content: 'Hello', sender: 'AI', timestamp: 't2', messageType: 'text' },
      { role: 'user', content: 'Pricing?', sender: 'CONTACT', timestamp: 't3', messageType: 'text' },
    ]);
    expect(s).toContain('Pricing?');
    expect(s).toContain('I need a human');
  });
});
