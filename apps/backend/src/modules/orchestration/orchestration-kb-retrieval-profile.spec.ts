/**
 * Live wiring: ConversationOrchestrationService.retrieveKbContext →
 * BotProfilesService.getKbDocumentAllowlistForActiveProfile → KbService.retrieve(documentIdAllowlist).
 */
import { jest as jestGlobal } from '@jest/globals';
import { ConversationOrchestrationService } from './orchestration.service';
import type { OrchestrationInput } from './dto';
import type { ConversationIntent } from '../conversation-policy/conversation-intent';

jestGlobal.mock('../kb/embedding/kb-vector-context.runner', () => ({
  kbVectorContextEnabledForTenant: jestGlobal.fn(() => false),
  runKbVectorContext: jestGlobal.fn(),
}));

const vectorContextModule = jestGlobal.requireMock('../kb/embedding/kb-vector-context.runner') as {
  kbVectorContextEnabledForTenant: jestGlobal.Mock;
  runKbVectorContext: jestGlobal.Mock;
};

function makeOrchestrationInput(): OrchestrationInput {
  return {
    tenantId: 'tenant-live',
    conversationId: 'conv-live',
    incomingMessage: {
      ghlLocationId: 'loc_1',
      ghlConversationId: 'ghl_c',
      ghlContactId: 'ct',
      messageContent: 'What are your hours?',
      messageType: 'text',
      timestamp: new Date().toISOString(),
      externalEventId: 'evt',
      eventType: 'inbound_message',
      dedupeKey: 'k',
      channelRaw: null,
    },
    tenant: {
      id: 'tenant-live',
      name: 'T',
      botEnabled: true,
      botMode: 'autopilot',
      handoverPaused: false,
      ghlLocationId: 'loc_1',
    },
    conversation: {
      id: 'conv-live',
      ghlConversationId: 'ghl_c',
      contactId: 'ct',
      channel: 'WHATSAPP',
      status: 'ACTIVE',
      metadata: {},
    },
  };
}

describe('ConversationOrchestrationService — KB retrieval vs assistant profile (live path)', () => {
  const kbRetrieve = jestGlobal.fn().mockResolvedValue({
    query: '',
    chunks: [],
    totalConsidered: 0,
    retrievalMode: 'keyword' as const,
  });
  const getKbAllowlist = jestGlobal.fn();

  let svc: ConversationOrchestrationService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    vectorContextModule.kbVectorContextEnabledForTenant.mockReturnValue(false);
    vectorContextModule.runKbVectorContext.mockReset();
    const kbService = { retrieve: kbRetrieve };
    const botProfiles = { getKbDocumentAllowlistForActiveProfile: getKbAllowlist };
    svc = new ConversationOrchestrationService(
      {} as never,
      {} as never,
      {} as never,
      kbService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      botProfiles as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('retrieveKbContext calls getKbDocumentAllowlistForActiveProfile then passes allowlist into kbService.retrieve (vault A only → doc ids from A, never B)', async () => {
    getKbAllowlist.mockResolvedValue({
      kind: 'allowlist',
      kbVaultAccessMode: 'selected_vaults',
      documentIds: ['doc-vault-a-1', 'doc-vault-a-2'],
      selectedVaultCount: 1,
      allowedDocumentCount: 2,
    });

    const retrieveKbContext = (
      svc as unknown as {
        retrieveKbContext: (
          input: OrchestrationInput,
          conversationId: string,
          intent: ConversationIntent,
        ) => Promise<{ chunks: unknown[]; meta: unknown }>;
      }
    ).retrieveKbContext.bind(svc);

    await retrieveKbContext(makeOrchestrationInput(), 'conv-live', 'UNKNOWN');

    expect(getKbAllowlist).toHaveBeenCalledTimes(1);
    expect(getKbAllowlist).toHaveBeenCalledWith('tenant-live');

    expect(kbRetrieve).toHaveBeenCalledTimes(1);
    expect(kbRetrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-live',
        conversationId: 'conv-live',
        documentIdAllowlist: ['doc-vault-a-1', 'doc-vault-a-2'],
      }),
    );
    // Vault B documents are excluded because they are not in the profile-derived allowlist
    expect(kbRetrieve.mock.calls[0][0].documentIdAllowlist).not.toContain('doc-vault-b-1');
  });

  it('retrieveKbContext passes documentIdAllowlist: [] when selected_vaults has zero vaults (no fallback)', async () => {
    getKbAllowlist.mockResolvedValue({
      kind: 'none',
      kbVaultAccessMode: 'selected_vaults',
      reason: 'profileKnowledgeVaultsEmpty',
      selectedVaultCount: 0,
      allowedDocumentCount: 0,
    });

    const retrieveKbContext = (
      svc as unknown as {
        retrieveKbContext: (
          input: OrchestrationInput,
          conversationId: string,
          intent: ConversationIntent,
        ) => Promise<{ chunks: unknown[]; meta: unknown }>;
      }
    ).retrieveKbContext.bind(svc);

    await retrieveKbContext(makeOrchestrationInput(), 'conv-live', 'UNKNOWN');

    expect(kbRetrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        documentIdAllowlist: [],
      }),
    );
  });

  it('retrieveKbContext passes undefined documentIdAllowlist for all_vaults (all READY docs)', async () => {
    getKbAllowlist.mockResolvedValue({
      kind: 'all',
      kbVaultAccessMode: 'all_vaults',
      noActiveProfile: false,
      selectedVaultCount: 0,
      allowedDocumentCount: null,
    });

    const retrieveKbContext = (
      svc as unknown as {
        retrieveKbContext: (
          input: OrchestrationInput,
          conversationId: string,
          intent: ConversationIntent,
        ) => Promise<{ chunks: unknown[]; meta: unknown }>;
      }
    ).retrieveKbContext.bind(svc);

    await retrieveKbContext(makeOrchestrationInput(), 'conv-live', 'UNKNOWN');

    expect(kbRetrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        documentIdAllowlist: undefined,
      }),
    );
  });

  it('uses vector context as KB memory only when staging vector context runner succeeds', async () => {
    getKbAllowlist.mockResolvedValue({
      kind: 'all',
      kbVaultAccessMode: 'all_vaults',
      noActiveProfile: false,
      selectedVaultCount: 0,
      allowedDocumentCount: null,
    });
    vectorContextModule.kbVectorContextEnabledForTenant.mockReturnValue(true);
    vectorContextModule.runKbVectorContext.mockResolvedValue({
      ok: true,
      topChunkIds: ['rag-1'],
      result: {
        query: 'What are your prices?',
        chunks: [
          {
            chunkId: 'rag-1',
            documentId: 'doc-rag',
            title: 'Pricing',
            source: 'manual',
            content: 'Our Basic plan is $29 per month.',
            relevanceScore: 0.42,
            metadata: { retrievalSource: 'rag_vector_context' },
          },
        ],
        totalConsidered: 3,
        retrievalMode: 'vector',
      },
    });

    const retrieveKbContext = (
      svc as unknown as {
        retrieveKbContext: (
          input: OrchestrationInput,
          conversationId: string,
          intent: ConversationIntent,
          opts?: { retrieveQuery?: string; kbFilterIntent?: ConversationIntent; kbFilterUserMessage?: string },
        ) => Promise<{ chunks: unknown[]; meta: { retrievalMode: string; documentIds?: string[] } }>;
      }
    ).retrieveKbContext.bind(svc);

    const out = await retrieveKbContext(makeOrchestrationInput(), 'conv-live', 'PRICE', {
      retrieveQuery: 'What are your prices?',
      kbFilterIntent: 'PRICE',
      kbFilterUserMessage: 'What are your prices?',
    });

    expect(kbRetrieve).toHaveBeenCalledTimes(1);
    expect(vectorContextModule.runKbVectorContext).toHaveBeenCalledTimes(1);
    expect(out.chunks).toEqual([
      expect.objectContaining({ chunkId: 'rag-1', metadata: { retrievalSource: 'rag_vector_context' } }),
    ]);
    expect(out.meta.retrievalMode).toBe('vector');
    expect(out.meta.documentIds).toEqual(['doc-rag']);
  });

  it('falls back to keyword result when vector context runner fails', async () => {
    getKbAllowlist.mockResolvedValue({
      kind: 'all',
      kbVaultAccessMode: 'all_vaults',
      noActiveProfile: false,
      selectedVaultCount: 0,
      allowedDocumentCount: null,
    });
    kbRetrieve.mockResolvedValueOnce({
      query: 'What are your hours?',
      chunks: [
        {
          chunkId: 'kw-1',
          documentId: 'doc-kw',
          title: 'Hours',
          source: 'manual',
          content: 'We are open 9am to 5pm.',
          relevanceScore: 0.9,
          metadata: {},
        },
      ],
      totalConsidered: 1,
      retrievalMode: 'keyword' as const,
    });
    vectorContextModule.kbVectorContextEnabledForTenant.mockReturnValue(true);
    vectorContextModule.runKbVectorContext.mockResolvedValue({
      ok: false,
      reason: 'weak_or_empty_vector_candidates',
    });

    const retrieveKbContext = (
      svc as unknown as {
        retrieveKbContext: (
          input: OrchestrationInput,
          conversationId: string,
          intent: ConversationIntent,
          opts?: { retrieveQuery?: string; kbFilterIntent?: ConversationIntent; kbFilterUserMessage?: string },
        ) => Promise<{ chunks: unknown[]; meta: { retrievalMode: string; documentIds?: string[] } }>;
      }
    ).retrieveKbContext.bind(svc);

    const out = await retrieveKbContext(makeOrchestrationInput(), 'conv-live', 'BUSINESS_HOURS', {
      retrieveQuery: 'What are your hours?',
      kbFilterIntent: 'BUSINESS_HOURS',
      kbFilterUserMessage: 'What are your hours?',
    });

    expect(out.chunks).toEqual([expect.objectContaining({ chunkId: 'kw-1' })]);
    expect(out.meta.retrievalMode).toBe('keyword');
    expect(out.meta.documentIds).toEqual(['doc-kw']);
  });
});
