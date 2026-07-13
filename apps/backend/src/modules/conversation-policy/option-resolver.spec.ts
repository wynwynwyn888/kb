import type { MemoryEntry } from '../orchestration/dto';
import type { AisbpPolicyStateV1 } from './conversation-policy-state';
import {
  isOptionSelectionSingleToken,
  isPureOptionSelectionWithMemory,
  parseAssistantOptionLines,
  resolveMultiSelectionBurst,
  resolveShortSelection,
} from './option-resolver';

const baseState = (): AisbpPolicyStateV1 => ({
  v: 1,
  activeTopic: null,
  awaiting: null,
  options: undefined,
  lastAssistantOptions: undefined,
  optionsUpdatedAt: null,
  optionsSource: null,
  optionsDerivedFromChunkIds: null,
  optionsTenantId: null,
  expiresAt: null,
  updatedAt: null,
  memoryResetAt: null,
  resetVersion: 0,
});

describe('option-resolver — generic parsing', () => {
  it('parses A) B) C) lines', () => {
    const text = 'Pick one:\nA) First item\nB) Second item\nC) Third\n';
    const o = parseAssistantOptionLines(text);
    expect(o.A).toBe('First item');
    expect(o.B).toBe('Second item');
    expect(o.C).toBe('Third');
  });

  it('parses A. and A: variants', () => {
    const text = 'A. Haircut & Styling\nB: Colour Services\nC) Treatments';
    const o = parseAssistantOptionLines(text);
    expect(o.A).toBe('Haircut & Styling');
    expect(o.B).toBe('Colour Services');
    expect(o.C).toBe('Treatments');
  });

  it('parses 1. 2. numeric lists into A/B labels', () => {
    const text = '1. Ladies Cut\n2. Men Cut\n3. Kids Cut';
    const o = parseAssistantOptionLines(text);
    expect(o.A).toBe('Ladies Cut');
    expect(o.B).toBe('Men Cut');
    expect(o.C).toBe('Kids Cut');
  });

  it('parses a consecutive bullet list (2+ bullets) when no labels exist', () => {
    const text = 'Here:\n- Service Menu\n- Address\n- Hours';
    const o = parseAssistantOptionLines(text);
    expect(o.A).toBe('Service Menu');
    expect(o.B).toBe('Address');
    expect(o.C).toBe('Hours');
  });

  it('returns empty when only one bullet (likely not an option list)', () => {
    const text = 'Note:\n- Just one item';
    const o = parseAssistantOptionLines(text);
    expect(Object.keys(o)).toHaveLength(0);
  });
});

describe('option-resolver — resolution from memory and state', () => {
  it('uses prior assistant options from memory when state has no options', () => {
    const state = baseState();
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

  it('maps "first" / "last" / "second" / "third" to ordered labels', () => {
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      options: { A: 'Alpha', B: 'Beta', C: 'Gamma', D: 'Delta' },
    };
    expect(resolveShortSelection('first', state, [])?.selectedText).toBe('Alpha');
    expect(resolveShortSelection('second', state, [])?.selectedText).toBe('Beta');
    expect(resolveShortSelection('third', state, [])?.selectedText).toBe('Gamma');
    expect(resolveShortSelection('last', state, [])?.selectedText).toBe('Delta');
  });

  it('maps numeric digit to ordered label', () => {
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      options: { A: 'Alpha', B: 'Beta', C: 'Gamma' },
    };
    expect(resolveShortSelection('2', state, [])?.selectedText).toBe('Beta');
    expect(resolveShortSelection('3', state, [])?.selectedText).toBe('Gamma');
  });

  it('handles "option A" / "choice 2" phrasing', () => {
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      options: { A: 'Alpha', B: 'Beta' },
    };
    expect(resolveShortSelection('option A', state, [])?.selectedText).toBe('Alpha');
    expect(resolveShortSelection('choice 2', state, [])?.selectedText).toBe('Beta');
  });

  it('returns null on unresolvable input (no false positives)', () => {
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      options: { A: 'Alpha', B: 'Beta' },
    };
    expect(resolveShortSelection('zzz', state, [])).toBeNull();
    expect(resolveShortSelection('what', state, [])).toBeNull();
  });

  it('spa-style A–F menu: F maps to Daycare (not E)', () => {
    const menu =
      'A) Essential Care\nB) Dapper Care\nC) Bath Reset\nD) Dapper Signature Spa Ritual\nE) Ayurvedic Herbal Ritual\nF) Daycare';
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      awaiting: 'option_selection',
      options: parseAssistantOptionLines(menu),
      lastAssistantOptions: parseAssistantOptionLines(menu),
    };
    const r = resolveShortSelection('F', state, []);
    expect(r?.selectedLabel).toBe('F');
    expect(r?.selectedText).toBe('Daycare');
  });

  it('lowercase f resolves same as F', () => {
    const menu =
      'A) Essential Care\nB) Dapper Care\nC) Bath Reset\nD) Dapper Signature Spa Ritual\nE) Ayurvedic Herbal Ritual\nF) Daycare';
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      awaiting: 'option_selection',
      options: parseAssistantOptionLines(menu),
    };
    const r = resolveShortSelection('  f  ', state, []);
    expect(r?.selectedLabel).toBe('F');
    expect(r?.selectedText).toBe('Daycare');
  });

  it('unknown letter G when menu is A–F → null (clarification path)', () => {
    const menu =
      'A) Essential Care\nB) Dapper Care\nC) Bath Reset\nD) Dapper Signature Spa Ritual\nE) Ayurvedic Herbal Ritual\nF) Daycare';
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      awaiting: 'option_selection',
      options: parseAssistantOptionLines(menu),
    };
    expect(resolveShortSelection('G', state, [])).toBeNull();
  });

  it('detects a pure selection only while option memory is active', () => {
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      awaiting: 'option_selection',
      options: { A: 'One', B: 'Two' },
    };
    expect(isPureOptionSelectionWithMemory(state, 'A')).toBe(true);
    expect(isPureOptionSelectionWithMemory(state, 'hello')).toBe(false);
    expect(isPureOptionSelectionWithMemory({ ...state, awaiting: null }, 'A')).toBe(false);
  });

  it('does not resolve against an older menu after a newer non-option assistant reply', () => {
    const memory: MemoryEntry[] = [
      { role: 'assistant', content: '1. Easy to use\n2. Cost', sender: 'AI', timestamp: '2026-07-13T09:59:00.000Z', messageType: 'text' },
      { role: 'user', content: 'hmm', sender: 'CONTACT', timestamp: '2026-07-13T10:00:00.000Z', messageType: 'text' },
      { role: 'assistant', content: 'What would you like to understand first?', sender: 'AI', timestamp: '2026-07-13T10:03:00.000Z', messageType: 'text' },
    ];
    expect(resolveShortSelection('1', baseState(), memory)).toBeNull();
  });

  it('isOptionSelectionSingleToken: single letter/digit only', () => {
    expect(isOptionSelectionSingleToken('F')).toBe(true);
    expect(isOptionSelectionSingleToken('f')).toBe(true);
    expect(isOptionSelectionSingleToken('6')).toBe(true);
    expect(isOptionSelectionSingleToken('FF')).toBe(false);
    expect(isOptionSelectionSingleToken('E F')).toBe(false);
  });

  it('resolves a 2 → 3 → 4 trailing-debounce burst in customer order', () => {
    const state: AisbpPolicyStateV1 = {
      ...baseState(),
      awaiting: 'option_selection',
      options: {
        A: 'Leads going cold',
        B: 'Prospects ask for price but do not book',
        C: 'Too much manual chasing',
        D: 'Unsure how many sales are lost',
      },
    };
    const result = resolveMultiSelectionBurst(['2', '3', '4'], state, []);
    expect(result?.selections.map(selection => selection.raw)).toEqual(['2', '3', '4']);
    expect(result?.selections.map(selection => selection.selectedText)).toEqual([
      'Prospects ask for price but do not book',
      'Too much manual chasing',
      'Unsure how many sales are lost',
    ]);
  });

  it('does not treat a mixed burst as a multi-selection turn', () => {
    const state: AisbpPolicyStateV1 = {
      ...baseState(), awaiting: 'option_selection', options: { A: 'One', B: 'Two' },
    };
    expect(resolveMultiSelectionBurst(['2', 'what is the price?'], state, [])).toBeNull();
  });
});
