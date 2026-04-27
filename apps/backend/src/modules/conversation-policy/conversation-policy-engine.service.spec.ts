import { ConversationPolicyEngineService } from './conversation-policy-engine.service';
import { MENU_CATEGORY_PROMPT, SELECTION_UNCLEAR_REPLY } from './policy-menu-copy';
import { emptyPolicyState } from './conversation-policy-state';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import type { MemoryEntry } from '../orchestration/dto';

function mem(
  role: MemoryEntry['role'],
  content: string,
  ts: string,
): MemoryEntry {
  return {
    role,
    content,
    sender: role === 'user' ? 'CONTACT' : 'AI',
    timestamp: ts,
    messageType: 'text',
  };
}

function chunk(partial: Partial<RetrievalChunk> & Pick<RetrievalChunk, 'title' | 'content'>): RetrievalChunk {
  return {
    chunkId: 'c1',
    documentId: 'd1',
    title: partial.title,
    content: partial.content,
    source: partial.source ?? 'faq',
    relevanceScore: partial.relevanceScore ?? 0.5,
    metadata: partial.metadata ?? {},
  };
}

describe('ConversationPolicyEngineService', () => {
  const engine = new ConversationPolicyEngineService();

  const hoursFaq = chunk({
    title: 'FAQ: What are your opening hours?',
    content: 'Weekdays 9am-11pm\nWeekends 9am-12am',
    metadata: { question: 'What are your opening hours?' },
  });

  const menuAwaitingState = {
    v: 1 as const,
    activeTopic: 'menu',
    awaiting: 'menu_category_selection' as const,
    options: {
      A: 'Starters',
      B: 'Mains',
      C: 'Desserts',
      D: 'Vegan options',
    },
    lastAssistantOptions: {
      A: 'Starters',
      B: 'Mains',
      C: 'Desserts',
      D: 'Vegan options',
    },
    expiresAt: null,
    updatedAt: new Date().toISOString(),
  };

  it('A: hours intent keeps ranked KB for generation (no forced reply)', () => {
    const out = engine.evaluate({
      intent: 'BUSINESS_HOURS',
      incomingRaw: 'ur opening hour?',
      memory: [] as MemoryEntry[],
      policyState: emptyPolicyState(),
      kbChunksRanked: [hoursFaq],
    });
    expect(out.policyForcedReply).toBeNull();
    expect(out.kbChunks).toHaveLength(1);
    expect(out.policyReplyKind).toBe('none');
  });

  it('B: menu intent with no usable KB → category prompt + awaiting state', () => {
    const out = engine.evaluate({
      intent: 'MENU',
      incomingRaw: 'your menu',
      memory: [] as MemoryEntry[],
      policyState: emptyPolicyState(),
      kbChunksRanked: [],
    });
    expect(out.policyForcedReply).toBe(MENU_CATEGORY_PROMPT);
    expect(out.policyReplyKind).toBe('menu_category_prompt');
    expect(out.nextPolicyState.awaiting).toBe('menu_category_selection');
    expect(out.nextPolicyState.options?.A).toBe('Starters');
    expect(out.nextPolicyState.expiresAt).toBeNull();
  });

  it('C: menu awaiting + "A" → starters no-KB reply', () => {
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'A',
      memory: [] as MemoryEntry[],
      policyState: menuAwaitingState,
      kbChunksRanked: [],
    });
    expect(out.resolvedSelection?.selectedText).toBe('Starters');
    expect(out.policyForcedReply).toContain('starters');
    expect(out.policyForcedReply).toMatch(/send you the menu/i);
    expect(out.policyReplyKind).toBe('menu_category_selected_no_kb');
    expect(out.nextPolicyState.awaiting).toBeNull();
  });

  it('D: menu awaiting + "first one" → starters', () => {
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'first one',
      memory: [] as MemoryEntry[],
      policyState: menuAwaitingState,
      kbChunksRanked: [],
    });
    expect(out.resolvedSelection?.selectedLabel).toBe('A');
    expect(out.resolvedSelection?.selectedText).toBe('Starters');
  });

  it('E: short selection with no options anywhere → clarification', () => {
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'A',
      memory: [] as MemoryEntry[],
      policyState: emptyPolicyState(),
      kbChunksRanked: [hoursFaq],
    });
    expect(out.policyForcedReply).toBe(SELECTION_UNCLEAR_REPLY);
    expect(out.policyReplyKind).toBe('selection_clarification');
  });

  it('F: business hours after menu flow clears awaiting (no selection path)', () => {
    const out = engine.evaluate({
      intent: 'BUSINESS_HOURS',
      incomingRaw: 'what time you open',
      memory: [] as MemoryEntry[],
      policyState: menuAwaitingState,
      kbChunksRanked: [hoursFaq],
    });
    expect(out.policyForcedReply).toBeNull();
    expect(out.nextPolicyState.awaiting).toBeNull();
    expect(out.nextPolicyState.options).toBeUndefined();
    expect(out.latestIntent).toBe('BUSINESS_HOURS');
    expect(out.kbChunks).toHaveLength(1);
  });

  it('menu awaiting + unresolved gibberish → clarification, keeps awaiting', () => {
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'zzz',
      memory: [] as MemoryEntry[],
      policyState: menuAwaitingState,
      kbChunksRanked: [],
    });
    expect(out.policyForcedReply).toBe(SELECTION_UNCLEAR_REPLY);
    expect(out.nextPolicyState.awaiting).toBe('menu_category_selection');
  });

  it('SHORT_SELECTION resolves from previous assistant options in memory', () => {
    const memory: MemoryEntry[] = [
      mem('user', 'menu?', '2026-04-26T10:00:00.000Z'),
      mem(
        'assistant',
        'Pick one:\nA) Starters\nB) Mains\nC) Desserts\nD) Vegan options',
        '2026-04-26T10:00:01.000Z',
      ),
    ];
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'B',
      memory,
      policyState: emptyPolicyState(),
      kbChunksRanked: [hoursFaq],
    });
    expect(out.resolvedSelection?.source).toBe('previous_assistant_options');
    expect(out.resolvedSelection?.selectedText).toBe('Mains');
    expect(out.policyForcedReply).toBeNull();
  });

  it('1: menu awaiting with no expiry — "A" still resolves after long delay semantics', () => {
    const staleButNoExpiry = { ...menuAwaitingState, expiresAt: null };
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'A',
      memory: [] as MemoryEntry[],
      policyState: staleButNoExpiry,
      kbChunksRanked: [],
    });
    expect(out.resolvedSelection?.selectedText).toBe('Starters');
    expect(out.policyReplyKind).toBe('menu_category_selected_no_kb');
  });

  it('3: menu category selection with KB does not force template', () => {
    const mainsKb = chunk({
      title: 'Mains menu',
      content: 'Grilled fish and vegetable curry.',
      metadata: {},
    });
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'B',
      memory: [] as MemoryEntry[],
      policyState: menuAwaitingState,
      kbChunksRanked: [mainsKb],
    });
    expect(out.policyForcedReply).toBeNull();
    expect(out.kbChunks).toHaveLength(1);
    expect(out.kbChunks[0]!.title).toContain('Mains');
  });

  it('5: book face wash is out-of-domain booking', () => {
    const out = engine.evaluate({
      intent: 'BOOKING',
      incomingRaw: 'i want to book face wash for 2pax',
      memory: [] as MemoryEntry[],
      policyState: menuAwaitingState,
      kbChunksRanked: [],
      tenantDisplayName: 'Ember & Soy',
    });
    expect(out.policyReplyKind).toBe('booking_out_of_domain');
    expect(out.policyForcedReply).toContain('Ember & Soy');
    expect(out.policyForcedReply).toMatch(/face wash|face\s*wash/i);
    expect(out.policyForcedReply).not.toMatch(/7:00|7:30/i);
    expect(out.nextPolicyState.awaiting).toBeNull();
  });

  it('6: book table for 2 pax asks date/time without invented slots', () => {
    const out = engine.evaluate({
      intent: 'BOOKING',
      incomingRaw: 'book table for 2 pax',
      memory: [] as MemoryEntry[],
      policyState: emptyPolicyState(),
      kbChunksRanked: [],
      tenantDisplayName: 'Ember & Soy',
    });
    expect(out.policyReplyKind).toBe('booking_ask_preference');
    expect(out.policyForcedReply).toContain('2 guests');
    expect(out.policyForcedReply).toMatch(/date and time/i);
    expect(out.policyForcedReply).not.toMatch(/7:00|7:30/);
  });
});
