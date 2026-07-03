// ghl-conversation-sync tests — upgrade path, short-circuit, recovery scheduling
import { jest as jestGlobal } from '@jest/globals';

const mockIngestInboundMessage = jestGlobal.fn();
const mockDecrypt = jestGlobal.fn();

jestGlobal.mock('./inbound-message-ingest', () => ({
  ingestInboundMessage: mockIngestInboundMessage,
  computeContentFingerprint: () => 'mock-fingerprint',
}));
jestGlobal.mock('./encryption', () => ({
  decrypt: mockDecrypt,
}));

// Mock global fetch for GHL API calls
const mockFetch = jestGlobal.fn();
(globalThis as any).fetch = mockFetch;

import { syncGhlConversationContext } from './ghl-conversation-sync';

function makeSupabaseMock(overrides: Partial<{
  connectionToken: string | null;
  convMetadata: Record<string, unknown>;
  lastSyncedId: string | null;
  messagesExist: Record<string, boolean>;
  laterOutbound: { id: string } | null;
}> = {}) {
  const {
    connectionToken = 'encrypted-token',
    convMetadata = {},
    lastSyncedId = null as string | null,
    messagesExist = {} as Record<string, boolean>,
    laterOutbound = null,
  } = overrides;
  // Chainable Supabase mock that supports arbitrary query chains
  function chainableQuery(terminal: () => Promise<any>): any {
    const proxy = new Proxy(function () { return proxy; }, {
      get(_target, prop: string) {
        if (prop === 'then' || prop === 'catch') return undefined;
        if (prop === 'maybeSingle' || prop === 'single') {
          return terminal;
        }
        return proxy;
      },
    });
    return proxy;
  }

  const supabase = {
    from: jestGlobal.fn((table: string) => {
      if (table === 'tenant_ghl_connections') {
        return {
          select: () => chainableQuery(async () => ({
            data: connectionToken ? { private_token_encrypted: connectionToken } : null,
            error: null,
          })),
        };
      }
      if (table === 'conversations') {
        return {
          select: () => chainableQuery(async () => ({
            data: { metadata: convMetadata },
            error: null,
          })),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'messages') {
        return {
          select: () => {
            const chain = chainableQuery(async () => ({ data: null, error: null }));
            // Override to return specific data when queried with ghlMessageId filter
            const originalGet = new Proxy(function () { return originalGet; }, {
              get(_t: any, p: string) {
                if (p === 'maybeSingle') {
                  return async () => ({ data: null, error: null });
                }
                return chain;
              },
            });
            return chain;
          },
        };
      }
      if (table === 'outbound_sends') {
        return {
          select: () => chainableQuery(async () => ({ data: null, error: null })),
        };
      }
      return { select: () => chainableQuery(async () => ({ data: null, error: null })) };
    }),
  };
  return supabase;
}

describe('syncGhlConversationContext', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockDecrypt.mockReturnValue('mock-access-token');
    mockIngestInboundMessage.mockImplementation(async (params: any) => ({
      inserted: true,
      duplicate: false,
      upgraded: false,
      messageId: `msg-${params.ghlMessageId ?? 'no-id'}`,
    }));
    process.env['GHL_PRE_REPLY_CONTEXT_SYNC_ALL'] = 'true';
  });

  afterEach(() => {
    delete process.env['GHL_PRE_REPLY_CONTEXT_SYNC_ALL'];
  });

  // ── Test 2: Short-circuit returns empty but with no recovered GHL ID ──
  it('short-circuits when lastSyncedId matches newest GHL message id', async () => {
    const ghlMsgId = 'ghl-newest-msg';
    mockDecrypt.mockReturnValue('token');

    // Mock GHL API: search returns native conv ID, then fetch messages
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversations: [{ id: 'native-conv-1' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: {
            messages: [
              {
                id: ghlMsgId,
                body: 'Hello',
                direction: 'inbound',
                source: 'api',
                dateAdded: new Date().toISOString(),
                status: 'delivered',
              },
            ],
          },
        }),
      });

    const supabase = makeSupabaseMock({
      convMetadata: { lastSyncedGhlMessageId: ghlMsgId },
    });

    const result = await syncGhlConversationContext({
      supabase: supabase as any,
      tenantId: 't1',
      ghlLocationId: 'loc1',
      conversationId: 'conv1',
      contactId: 'c1',
    });

    // Short-circuited: no messages processed, no insertedContactInboundIds
    expect(result.insertedContactInboundIds).toHaveLength(0);
    // No recovered GHL ID because no messages were iterated
    expect(result.latestRecoveredGhlMessageId).toBeNull();
    expect(mockIngestInboundMessage).not.toHaveBeenCalled();
  });

  // ── Test 1: Newly inserted INBOUND/CONTACT → populated insertedContactInboundIds ──
  it('inserts new INBOUND/CONTACT message and tracks in insertedContactInboundIds', async () => {
    const ghlMsgId = 'ghl-new-msg';
    const msgTs = new Date().toISOString();

    mockIngestInboundMessage.mockResolvedValueOnce({
      inserted: true,
      duplicate: false,
      upgraded: false,
      messageId: 'kb-msg-new',
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversations: [{ id: 'native-conv-2' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: {
            messages: [
              {
                id: ghlMsgId,
                body: 'New message',
                direction: 'inbound',
                source: 'api',
                dateAdded: msgTs,
                status: 'delivered',
              },
            ],
          },
        }),
      });

    const supabase = makeSupabaseMock({
      lastSyncedId: 'old-msg-id', // different → no short-circuit
    });

    const result = await syncGhlConversationContext({
      supabase: supabase as any,
      tenantId: 't1',
      ghlLocationId: 'loc1',
      conversationId: 'conv1',
      contactId: 'c1',
    });

    expect(result.insertedContactInboundIds).toHaveLength(1);
    expect(result.latestRecoveredGhlMessageId).toBe(ghlMsgId);
    expect(result.latestRecoveredContactInboundAt).toBe(msgTs);
  });

  // ── Test 3: Upgraded INBOUND/CONTACT message → populated insertedContactInboundIds ──
  it('upgraded INBOUND/CONTACT message populates insertedContactInboundIds', async () => {
    const ghlMsgId = 'ghl-upgrade-msg';
    const msgTs = new Date().toISOString();

    mockIngestInboundMessage.mockResolvedValueOnce({
      inserted: false,
      duplicate: false,
      upgraded: true,
      messageId: 'kb-msg-upgraded',
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversations: [{ id: 'native-conv-3' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: {
            messages: [
              {
                id: ghlMsgId,
                body: 'Upgraded message',
                direction: 'inbound',
                source: 'api',
                dateAdded: msgTs,
                status: 'delivered',
              },
            ],
          },
        }),
      });

    const supabase = makeSupabaseMock({
      lastSyncedId: 'different-id',
    });

    const result = await syncGhlConversationContext({
      supabase: supabase as any,
      tenantId: 't1',
      ghlLocationId: 'loc1',
      conversationId: 'conv1',
      contactId: 'c1',
    });

    // Upgraded message should be in insertedContactInboundIds
    expect(result.insertedContactInboundIds).toHaveLength(1);
    expect(result.latestRecoveredGhlMessageId).toBe(ghlMsgId);
    expect(result.latestRecoveredContactInboundAt).toBe(msgTs);
    expect(result.upgradedMetadataIds).toHaveLength(1);
  });

  // ── Duplicate INBOUND/CONTACT → still populates insertedContactInboundIds ──
  it('duplicate INBOUND/CONTACT message populates insertedContactInboundIds', async () => {
    const ghlMsgId = 'ghl-dup-msg';
    const msgTs = new Date().toISOString();

    mockIngestInboundMessage.mockResolvedValueOnce({
      inserted: false,
      duplicate: true,
      upgraded: false,
      messageId: 'kb-msg-dup',
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversations: [{ id: 'native-conv-4' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: {
            messages: [
              {
                id: ghlMsgId,
                body: 'Duplicate message',
                direction: 'inbound',
                source: 'api',
                dateAdded: msgTs,
                status: 'delivered',
              },
            ],
          },
        }),
      });

    const supabase = makeSupabaseMock({
      lastSyncedId: 'different-id',
    });

    const result = await syncGhlConversationContext({
      supabase: supabase as any,
      tenantId: 't1',
      ghlLocationId: 'loc1',
      conversationId: 'conv1',
      contactId: 'c1',
    });

    expect(result.insertedContactInboundIds).toHaveLength(1);
    expect(result.latestRecoveredGhlMessageId).toBe(ghlMsgId);
    expect(result.latestRecoveredContactInboundAt).toBe(msgTs);
  });

  // ── No contact ID → skips ──
  it('skips when contactId is empty', async () => {
    const result = await syncGhlConversationContext({
      supabase: makeSupabaseMock() as any,
      tenantId: 't1',
      ghlLocationId: 'loc1',
      conversationId: 'conv1',
      contactId: '',
    });
    expect(result.synced).toBe(0);
    expect(result.insertedContactInboundIds).toHaveLength(0);
  });
});
