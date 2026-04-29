import { jest as jestGlobal } from '@jest/globals';

jestGlobal.mock('../../modules/orchestration/orchestration.service', () => ({
  ConversationOrchestrationService: class {},
}));

jestGlobal.mock('@aisbp/formatter', () => ({
  stripCustomerFacingMeta: (x: string) => x,
  stripModelThinking: (x: string) => x,
}));

jestGlobal.mock('../../modules/conversation-policy/conversation-intent', () => ({
  classifyConversationIntent: () => 'MENU',
}));

import type { Job } from 'bullmq';

import { InboundMessageProcessor } from './inbound-message.processor';

const CONV_ID = 'c1111111-1111-1111-1111-111111111111';

const mockInboundQueueAdd = jestGlobal.fn(async () => {});
const mockSendBubbleQueueAdd = jestGlobal.fn(async () => {});

const orchestrate = jestGlobal.fn(async () => ({ outcome: 'SKIP' as const }));

const mockOrchestration = {
  orchestrate,
  loadTenantContext: jestGlobal.fn(async () => ({ botMode: 'autopilot' })),
  loadPromptConfig: jestGlobal.fn(async () => ({})),
  loadAgencyPolicy: jestGlobal.fn(async () => ({})),
  loadConversation: jestGlobal.fn(async () => ({})),
};

const mockResetService = {
  isChatResetAllowedForContact: jestGlobal.fn(async () => false),
  performBotStateReset: jestGlobal.fn(async () => ({
    memoryResetAt: '2026-01-01T00:00:00.000Z',
    resetVersion: 1,
    clearedKeys: ['activeTopic'] as const,
  })),
  buildConfirmationReplyPlan: jestGlobal.fn(() => ({
    planStatus: 'PLANNED',
    responseMode: 'standard',
    handoverRecommended: false,
    confidence: 1,
    rationale: 'x',
    bubbles: [{ index: 0, text: 'ok' }],
    suggestedActions: [],
    draftProvenance: 'policy_reply' as const,
  })),
};

const mockSupabase = {
  from: jestGlobal.fn(),
};

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

function makeJob<T>(name: string, data: T): Job<T> {
  return { id: '1', name, data } as Job<T>;
}

/** Minimal PromiseLike chain so `await supabase.from(...).select().eq()...` resolves. */
function resolvedQuery<T>(value: T) {
  const chain = {
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    then(onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(value).then(onFulfilled, onRejected);
    },
    catch(onRejected: (e: unknown) => unknown) {
      return Promise.resolve(value).catch(onRejected);
    },
  };
  return chain;
}

/**
 * Conversation lookup builder used by the processor:
 * - `.from('conversations').select(...).eq(...).maybeSingle()` → returns `{data, error}` for external id and derived key paths
 * - `.from('conversations').select(...).eq(...).eq(...).eq(...).order(...).limit(...)` → returns
 *   the legacy fallback list (always [] in our happy-path tests).
 * - `.from('conversations').select('metadata').eq(...).single()` → metadata row read for debounce bump.
 * - `.from('conversations').update(...).eq(...)` → returns `{error: null}`.
 */
function makeConversationsTableMock(externalIdLookup: { id: string } | null) {
  return {
    select: (_cols?: string) => {
      const chainable = {
        eq: () => chainable,
        order: () => chainable,
        limit: async () => ({ data: [], error: null }),
        single: async () => ({ data: { metadata: {} }, error: null }),
        maybeSingle: async () => ({ data: externalIdLookup, error: null }),
      };
      return chainable;
    },
    update: () => ({
      eq: () => ({ error: null }),
    }),
    insert: () => ({
      select: () => ({
        single: async () => ({ data: { id: CONV_ID }, error: null }),
      }),
    }),
  };
}

describe('InboundMessageProcessor', () => {
  let processor: InboundMessageProcessor;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    orchestrate.mockResolvedValue({ outcome: 'SKIP' });
    processor = new InboundMessageProcessor(
      mockOrchestration as never,
      mockResetService as never,
      { add: mockSendBubbleQueueAdd } as never,
      { add: mockInboundQueueAdd } as never,
    );
  });

  it('persist stores inbound and schedules orchestrate with 5s delay and versioned jobId', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { id: 'tenant-1' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'conversations') {
        return makeConversationsTableMock({ id: CONV_ID });
      }
      if (table === 'messages') {
        return { insert: () => ({ error: null }) };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_1',
        ghlContactId: 'ct_1',
        messageContent: 'Hello',
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
      }),
    );

    expect(mockInboundQueueAdd).toHaveBeenCalledWith(
      'orchestrate',
      expect.objectContaining({
        conversationId: CONV_ID,
        debounceVersion: 1,
        tenantId: 'tenant-1',
      }),
      expect.objectContaining({
        delay: 5000,
        jobId: `deb:${CONV_ID}:1`,
      }),
    );
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('persist without provider conversationId reuses the same row by tenant+channel+contact', async () => {
    let createCalls = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { id: 'tenant-1' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'conversations') {
        return {
          select: (_cols?: string) => {
            const chainable = {
              eq: () => chainable,
              order: () => chainable,
              limit: async () => ({ data: [], error: null }),
              single: async () => ({ data: { metadata: {} }, error: null }),
              // Once a row exists (createCalls>0), the derived-key lookup finds it and we reuse.
              maybeSingle: async () => ({
                data: createCalls > 0 ? { id: CONV_ID } : null,
                error: null,
              }),
            };
            return chainable;
          },
          update: () => ({ eq: () => ({ error: null }) }),
          insert: () => ({
            select: () => ({
              single: async () => {
                createCalls++;
                return { data: { id: CONV_ID }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'messages') return { insert: () => ({ error: null }) };
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: '',
        ghlContactId: 'ct_1',
        messageContent: 'Hello',
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
      }),
    );

    expect(createCalls).toBe(1);
    expect(mockInboundQueueAdd).toHaveBeenCalledWith(
      'orchestrate',
      expect.objectContaining({ conversationId: CONV_ID, debounceVersion: 1 }),
      expect.any(Object),
    );

    // Second message from the same contact: derived-key lookup finds the existing row.
    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: '',
        ghlContactId: 'ct_1',
        messageContent: 'still me',
        messageType: 'text',
        timestamp: '2026-01-01T00:00:01Z',
        smokeImmediate: false,
      }),
    );
    expect(createCalls).toBe(1);
  });

  it('orchestrate skips when conversation debounce version advanced (stale job)', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { metadata: { inboundDebounce: { pendingVersion: 5 } } },
                error: null,
              }),
            }),
          }),
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('orchestrate', {
        tenantId: 'tenant-1',
        conversationId: CONV_ID,
        locationId: 'loc_1',
        ghlContactId: 'ct_1',
        ghlConversationId: 'ghl_conv_1',
        debounceVersion: 3,
      }),
    );

    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('orchestrate runs pipeline when version matches and passes recent inbound batch', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { metadata: { inboundDebounce: { pendingVersion: 4 } } },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'messages') {
        return {
          insert: () => ({ error: null }),
          select: () =>
            resolvedQuery({
              data: [
                { content: 'Actually mains', created_at: '2026-01-01T00:00:02.000Z' },
                { content: 'Menu?', created_at: '2026-01-01T00:00:01.000Z' },
              ],
              error: null,
            }),
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('orchestrate', {
        tenantId: 'tenant-1',
        conversationId: CONV_ID,
        locationId: 'loc_1',
        ghlContactId: 'ct_1',
        ghlConversationId: 'ghl_conv_1',
        debounceVersion: 4,
      }),
    );

    expect(orchestrate).toHaveBeenCalledTimes(1);
    const arg = orchestrate.mock.calls[0]![0] as { recentInboundBatch?: string[]; incomingMessage?: { messageContent?: string } };
    expect(arg.recentInboundBatch).toEqual(['Menu?', 'Actually mains']);
    expect(arg.incomingMessage?.messageContent).toBe('Actually mains');
  });

  it('orchestrate: exact /new triggers reset service and skips AI orchestration', async () => {
    mockResetService.isChatResetAllowedForContact.mockResolvedValue(true);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { metadata: { inboundDebounce: { pendingVersion: 4 } } },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'messages') {
        return {
          select: () =>
            resolvedQuery({
              data: [{ content: '/new', created_at: '2026-01-01T00:00:02.000Z' }],
              error: null,
            }),
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('orchestrate', {
        tenantId: 'tenant-1',
        conversationId: CONV_ID,
        locationId: 'loc_1',
        ghlContactId: 'ct_1',
        ghlConversationId: 'ghl_conv_1',
        debounceVersion: 4,
      }),
    );

    expect(mockResetService.performBotStateReset).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV_ID,
        tenantId: 'tenant-1',
        source: 'chat_command',
        resetCommand: '/new',
      }),
    );
    expect(orchestrate).not.toHaveBeenCalled();
    expect(mockSendBubbleQueueAdd).toHaveBeenCalled();
  });

  it('orchestrate: /new when reset disabled falls through to normal orchestration', async () => {
    mockResetService.isChatResetAllowedForContact.mockResolvedValue(false);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { metadata: { inboundDebounce: { pendingVersion: 4 } } },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'messages') {
        return {
          select: () =>
            resolvedQuery({
              data: [{ content: '/new', created_at: '2026-01-01T00:00:02.000Z' }],
              error: null,
            }),
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('orchestrate', {
        tenantId: 'tenant-1',
        conversationId: CONV_ID,
        locationId: 'loc_1',
        ghlContactId: 'ct_1',
        ghlConversationId: 'ghl_conv_1',
        debounceVersion: 4,
      }),
    );

    expect(mockResetService.performBotStateReset).not.toHaveBeenCalled();
    expect(orchestrate).toHaveBeenCalled();
  });
});
