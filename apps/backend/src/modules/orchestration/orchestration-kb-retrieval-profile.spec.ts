/**
 * Live wiring: ConversationOrchestrationService.retrieveKbContext →
 * BotProfilesService.getKbDocumentAllowlistForActiveProfile → KbService.retrieve(documentIdAllowlist).
 */
import { jest as jestGlobal } from '@jest/globals';
import { ConversationOrchestrationService } from './orchestration.service';
import type { OrchestrationInput } from './dto';
import type { ConversationIntent } from '../conversation-policy/conversation-intent';

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
});
