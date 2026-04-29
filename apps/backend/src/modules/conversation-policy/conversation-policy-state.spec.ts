import {
  emptyPolicyState,
  parseAisbpPolicyState,
  policyStateAfterBotReset,
} from './conversation-policy-state';

describe('policyStateAfterBotReset', () => {
  it('clears option memory and bumps resetVersion', () => {
    const prev = {
      ...emptyPolicyState(),
      options: { A: 'Haircut' },
      awaiting: 'option_selection' as const,
      resetVersion: 2,
      memoryResetAt: '2020-01-01T00:00:00.000Z',
    };
    const now = '2026-04-28T12:00:00.000Z';
    const next = policyStateAfterBotReset(prev, now);
    expect(next.options).toBeUndefined();
    expect(next.lastAssistantOptions).toBeUndefined();
    expect(next.awaiting).toBeNull();
    expect(next.memoryResetAt).toBe(now);
    expect(next.resetVersion).toBe(3);
  });

  it('parseAisbpPolicyState reads memoryResetAt and resetVersion', () => {
    const meta = {
      aisbp_policy: {
        v: 1,
        memoryResetAt: '2026-01-02T00:00:00.000Z',
        resetVersion: 5,
      },
    };
    const p = parseAisbpPolicyState(meta);
    expect(p.memoryResetAt).toBe('2026-01-02T00:00:00.000Z');
    expect(p.resetVersion).toBe(5);
  });
});
