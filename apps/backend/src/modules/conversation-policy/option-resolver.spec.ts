import type { MemoryEntry } from '../orchestration/dto';
import type { AisbpPolicyStateV1 } from './conversation-policy-state';
import { parseAssistantOptionLines, resolveShortSelection } from './option-resolver';

describe('option-resolver', () => {
  it('parseAssistantOptionLines reads A) B) lines', () => {
    const text = 'Pick one:\nA) First item\nB) Second item\nC) Third\n';
    const o = parseAssistantOptionLines(text);
    expect(o.A).toBe('First item');
    expect(o.B).toBe('Second item');
    expect(o.C).toBe('Third');
  });

  it('resolveShortSelection uses prior assistant options from memory when state has no options', () => {
    const state: AisbpPolicyStateV1 = {
      v: 1,
      activeTopic: null,
      awaiting: null,
      options: undefined,
      lastAssistantOptions: undefined,
      expiresAt: null,
      updatedAt: null,
    };
    const memory: MemoryEntry[] = [
      {
        role: 'user',
        content: 'help',
        sender: 'CONTACT',
        timestamp: '2026-01-01T00:00:00Z',
        messageType: 'text',
      },
      {
        role: 'assistant',
        content: 'Choose:\nA) Warranty return\nB) Exchange\nC) Store credit\nD) Other',
        sender: 'AI',
        timestamp: '2026-01-01T00:00:01Z',
        messageType: 'text',
      },
    ];
    const r = resolveShortSelection('B', state, memory);
    expect(r).not.toBeNull();
    expect(r!.source).toBe('previous_assistant_options');
    expect(r!.selectedLabel).toBe('B');
    expect(r!.selectedText).toBe('Exchange');
  });

  it('resolveShortSelection maps "first" to first option', () => {
    const state: AisbpPolicyStateV1 = {
      v: 1,
      activeTopic: null,
      awaiting: null,
      options: { A: 'Alpha', B: 'Beta' },
      lastAssistantOptions: undefined,
      expiresAt: null,
      updatedAt: null,
    };
    const r = resolveShortSelection('first', state, []);
    expect(r?.selectedText).toBe('Alpha');
  });
});
