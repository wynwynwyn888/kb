import { ConversationPolicyEngineService } from './conversation-policy-engine.service';
import { MENU_PROMPT_NO_KB, SELECTION_UNCLEAR_REPLY } from './policy-menu-copy';
import { emptyPolicyState } from './conversation-policy-state';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import type { MemoryEntry } from '../orchestration/dto';

function mem(role: MemoryEntry['role'], content: string, ts: string): MemoryEntry {
  return {
    role,
    content,
    sender: role === 'user' ? 'CONTACT' : 'AI',
    timestamp: ts,
    messageType: 'text',
  };
}

function chunk(
  partial: Partial<RetrievalChunk> & Pick<RetrievalChunk, 'title' | 'content'>,
  id = 'c1',
): RetrievalChunk {
  return {
    chunkId: id,
    documentId: partial.documentId ?? 'd1',
    title: partial.title,
    content: partial.content,
    source: partial.source ?? 'rich_text',
    relevanceScore: partial.relevanceScore ?? 0.5,
    metadata: partial.metadata ?? {},
  };
}

describe('ConversationPolicyEngineService (universal — no hardcoded categories)', () => {
  const engine = new ConversationPolicyEngineService();

  const hoursFaq = chunk({
    title: 'FAQ: What are your opening hours?',
    content: 'Weekdays 9am-11pm\nWeekends 9am-12am',
    metadata: { question: 'What are your opening hours?', sectionTitle: 'OPENING HOURS' },
  });

  // Generic salon-style options, BUT note: the engine never invents these — they come from KB
  // section titles or assistant replies. The test simply seeds option memory for resolution paths.
  const salonAwaitingState = {
    v: 1 as const,
    activeTopic: 'menu',
    awaiting: 'option_selection' as const,
    options: {
      A: 'Haircut & Styling',
      B: 'Colour Services',
      C: 'Perm & Rebonding',
      D: 'Hair & Scalp Treatments',
    },
    lastAssistantOptions: {
      A: 'Haircut & Styling',
      B: 'Colour Services',
      C: 'Perm & Rebonding',
      D: 'Hair & Scalp Treatments',
    },
    optionsUpdatedAt: new Date().toISOString(),
    optionsSource: 'assistant_reply' as const,
    optionsDerivedFromChunkIds: null,
    expiresAt: null,
    updatedAt: new Date().toISOString(),
  };

  it('hours intent keeps ranked KB for generation (no forced reply)', () => {
    const out = engine.evaluate({
      intent: 'BUSINESS_HOURS',
      incomingRaw: 'ur opening hour?',
      memory: [],
      policyState: emptyPolicyState(),
      kbChunksRanked: [hoursFaq],
    });
    expect(out.policyForcedReply).toBeNull();
    expect(out.kbChunks).toHaveLength(1);
    expect(out.policyReplyKind).toBe('none');
  });

  it('MENU with KB present → no forced reply, KB passed through (universal flow)', () => {
    const menuKb = chunk({
      title: 'Service Menu',
      content: 'We offer haircuts, colour, treatments and more.',
      metadata: { sectionTitle: 'SERVICE MENU' },
    });
    const out = engine.evaluate({
      intent: 'MENU',
      incomingRaw: 'menu pls',
      memory: [],
      policyState: emptyPolicyState(),
      kbChunksRanked: [menuKb],
    });
    expect(out.policyForcedReply).toBeNull();
    expect(out.policyReplyKind).toBe('none');
    expect(out.kbChunks).toHaveLength(1);
    expect(out.nextPolicyState.activeTopic).toBe('menu');
  });

  it('MENU without KB → generic clarification (NEVER hardcoded categories)', () => {
    const out = engine.evaluate({
      intent: 'MENU',
      incomingRaw: 'menu pls',
      memory: [],
      policyState: emptyPolicyState(),
      kbChunksRanked: [],
    });
    expect(out.policyForcedReply).toBe(MENU_PROMPT_NO_KB);
    expect(out.policyForcedReply).not.toMatch(/Starters|Mains|Desserts|Vegan/);
    expect(out.policyReplyKind).toBe('menu_no_kb_clarification');
  });

  it('SHORT_SELECTION "A" with option memory → resolves to selectedText, KB if present', () => {
    const haircutKb = chunk({
      title: 'Haircut services',
      content: 'Ladies cut, men cut, kids cut',
      metadata: { sectionTitle: 'HAIRCUT & STYLING' },
    });
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'A',
      memory: [],
      policyState: salonAwaitingState,
      kbChunksRanked: [haircutKb],
    });
    expect(out.resolvedSelection?.selectedLabel).toBe('A');
    expect(out.resolvedSelection?.selectedText).toBe('Haircut & Styling');
    expect(out.policyForcedReply).toBeNull();
    expect(out.kbChunks).toHaveLength(1);
    expect(out.menuSelectionActive).toBe(true);
    expect(out.nextPolicyState.awaiting).toBeNull();
  });

  it('SHORT_SELECTION "first" resolves to label A from option memory', () => {
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'first one',
      memory: [],
      policyState: salonAwaitingState,
      kbChunksRanked: [],
    });
    expect(out.resolvedSelection?.selectedLabel).toBe('A');
    expect(out.resolvedSelection?.selectedText).toBe('Haircut & Styling');
  });

  it('SHORT_SELECTION with no options → clarification, no hardcoded list', () => {
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'A',
      memory: [],
      policyState: emptyPolicyState(),
      kbChunksRanked: [hoursFaq],
    });
    expect(out.policyForcedReply).toBe(SELECTION_UNCLEAR_REPLY);
    expect(out.policyReplyKind).toBe('selection_clarification');
  });

  it('BUSINESS_HOURS after option flow clears option memory (topic switch)', () => {
    const out = engine.evaluate({
      intent: 'BUSINESS_HOURS',
      incomingRaw: 'what time do you open',
      memory: [],
      policyState: salonAwaitingState,
      kbChunksRanked: [hoursFaq],
    });
    expect(out.policyForcedReply).toBeNull();
    expect(out.nextPolicyState.awaiting).toBeNull();
    expect(out.nextPolicyState.options).toBeUndefined();
  });

  it('SHORT_SELECTION resolves from previous assistant options in memory', () => {
    const memory: MemoryEntry[] = [
      mem('user', 'menu?', '2026-04-26T10:00:00.000Z'),
      mem(
        'assistant',
        'Pick one:\nA) Service Menu\nB) Address\nC) Hours\nD) Bookings',
        '2026-04-26T10:00:01.000Z',
      ),
    ];
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'B',
      memory,
      policyState: emptyPolicyState(),
      kbChunksRanked: [],
    });
    expect(out.resolvedSelection?.source).toBe('previous_assistant_options');
    expect(out.resolvedSelection?.selectedText).toBe('Address');
  });

  it('BOOKING is universal — does NOT reject "haircut" as out-of-domain', () => {
    const out = engine.evaluate({
      intent: 'BOOKING',
      incomingRaw: 'i want to book a haircut for tomorrow',
      memory: [],
      policyState: emptyPolicyState(),
      kbChunksRanked: [],
      tenantDisplayName: 'Lumière Hair Atelier',
    });
    // No forced restaurant-style "out of domain" rejection — let generation handle it.
    expect(out.policyForcedReply).toBeNull();
    expect(out.policyReplyKind).toBe('none');
    expect(out.nextPolicyState.activeTopic).toBe('booking');
  });

  it('stale option memory: when prompt config updatedAt is newer, options are cleared', () => {
    // Options recorded "yesterday", prompt re-saved "now" → engine should drop option memory.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stateWithOldOptions = {
      ...salonAwaitingState,
      optionsUpdatedAt: dayAgo,
    };
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'A',
      memory: [],
      policyState: stateWithOldOptions,
      kbChunksRanked: [],
      promptConfigUpdatedAtIso: new Date().toISOString(),
    });
    // After clearing, "A" no longer resolves.
    expect(out.resolvedSelection).toBeNull();
    expect(out.policyForcedReply).toBe(SELECTION_UNCLEAR_REPLY);
  });

  it('option memory beyond TTL is cleared (24h)', () => {
    const wayBack = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const stateExpired = {
      ...salonAwaitingState,
      optionsUpdatedAt: wayBack,
    };
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'A',
      memory: [],
      policyState: stateExpired,
      kbChunksRanked: [],
    });
    expect(out.resolvedSelection).toBeNull();
  });

  it('recordAssistantOptions captures A/B/C lists into option memory', () => {
    const next = engine.recordAssistantOptions(
      emptyPolicyState(),
      'Pick one:\nA) Haircut & Styling\nB) Colour Services',
      { tenantId: 'tenant-salon-1' },
    );
    expect(next.options?.A).toBe('Haircut & Styling');
    expect(next.options?.B).toBe('Colour Services');
    expect(next.optionsSource).toBe('assistant_reply');
    expect(next.optionsUpdatedAt).toBeTruthy();
    expect(next.optionsTenantId).toBe('tenant-salon-1');
  });

  it('clears option memory when tenant changes (tenant_changed)', () => {
    const dayAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const stateForOldTenant = {
      ...salonAwaitingState,
      optionsUpdatedAt: dayAgo,
      optionsTenantId: 'tenant-old',
    };
    const out = engine.evaluate({
      intent: 'SHORT_SELECTION',
      incomingRaw: 'A',
      memory: [],
      policyState: stateForOldTenant,
      kbChunksRanked: [],
      currentTenantId: 'tenant-new',
    });
    expect(out.resolvedSelection).toBeNull();
    expect(out.policyForcedReply).toBe(SELECTION_UNCLEAR_REPLY);
  });

  it('buildAndRecordOptionsFromKb derives generic options from KB section titles', () => {
    const built = engine.buildAndRecordOptionsFromKb(
      emptyPolicyState(),
      [
        chunk({
          title: 'Haircut',
          content: 'Cut',
          metadata: { sectionTitle: 'HAIRCUT & STYLING' },
        }, 'k1'),
        chunk({
          title: 'Colour',
          content: 'Colour',
          metadata: { sectionTitle: 'COLOUR SERVICES' },
        }, 'k2'),
      ],
      { tenantId: 'tenant-salon-1' },
    );
    expect(built).not.toBeNull();
    expect(built!.nextState.options?.A).toBe('Haircut & Styling');
    expect(built!.nextState.options?.B).toBe('Colour Services');
    expect(built!.reply).toContain('A) Haircut & Styling');
    expect(built!.nextState.optionsSource).toBe('policy_engine');
    expect(built!.nextState.optionsDerivedFromChunkIds).toEqual(['k1', 'k2']);
    expect(built!.nextState.optionsTenantId).toBe('tenant-salon-1');
  });
});
