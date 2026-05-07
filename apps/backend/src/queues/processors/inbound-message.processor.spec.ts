import { jest as jestGlobal } from '@jest/globals';

jestGlobal.mock('../../modules/orchestration/orchestration.service', () => ({
  ConversationOrchestrationService: class {},
}));

jestGlobal.mock('../../modules/intent-tags/tag-rule-match.service', () => ({
  TagRuleMatchService: class {},
}));

jestGlobal.mock('@aisbp/formatter', () => ({
  stripCustomerFacingMeta: (x: string) => x,
  stripModelThinking: (x: string) => x,
}));

jestGlobal.mock('../../modules/conversation-policy/conversation-intent', () => ({
  classifyConversationIntent: () => 'MENU',
}));

import type { Job } from 'bullmq';

import { INBOUND_DEBOUNCE_ENV_KEY } from '../../lib/inbound-burst-batch';
import { InboundMessageProcessor } from './inbound-message.processor';
import {
  VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
  VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE,
} from '../../modules/transcription/audio-transcription.service';

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
  evaluateChatResetEligibility: jestGlobal.fn(async () => ({
    allowed: false,
    deniedReason: 'env_disabled' as const,
    allowEnvValue: undefined as string | undefined,
    tenantSettingValue: undefined,
    whitelistConfigured: false,
    contactMatchedWhitelist: true,
  })),
  performBotStateReset: jestGlobal.fn(async () => ({
    memoryResetAt: '2026-01-01T00:00:00.000Z',
    resetVersion: 1,
    clearedKeys: ['activeTopic'] as const,
  })),
  clearHandoverAfterAllowedReset: jestGlobal.fn(async () => {}),
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

const mockInboundAutoTagging = {
  evaluateAndApplyAutoTags: jestGlobal.fn(async () => {}),
};

const mockGhlVoiceRecordingFetch = {
  tryFetchRecording: jestGlobal.fn(async () => ({ ok: false as const, reason: 'test_disabled' })),
};

const mockGhlVoiceMessageDiscovery = {
  discoverVoicePlaceholderMessageId: jestGlobal.fn(async () => ({
    ok: false as const,
    reason: 'test_skipped',
  })),
};

const mockGhlVoiceConversationDiscovery = {
  discoverConversationIdByContact: jestGlobal.fn(async () => ({
    ok: false as const,
    reason: 'test_skipped',
  })),
};

const mockFollowUpEngine = {
  noteInboundFromContact: jestGlobal.fn(async () => {}),
};

const mockHumanEscalationHolding = {
  tryEnqueueHoldingReply: jestGlobal.fn(async () => {}),
};

const mockAudioTranscription = {
  transcribeRemoteMedia: jestGlobal.fn(async () => ({
    ok: true as const,
    transcript: 'voice transcript',
    mediaBytes: 12,
    contentType: 'audio/mpeg',
  })),
  transcribeAudioBuffer: jestGlobal.fn(async () => ({
    ok: true as const,
    transcript: 'buffer transcript',
    mediaBytes: 8,
    contentType: 'audio/mpeg',
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
    delete process.env[INBOUND_DEBOUNCE_ENV_KEY];
    delete process.env['GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID'];
    delete process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'];
    delete process.env['GHL_VOICE_DISCOVER_DELAY_MS'];
    delete process.env['GHL_VOICE_DISCOVER_MAX_ATTEMPTS'];
    delete process.env['GHL_VOICE_DISCOVER_CONVERSATION_ID'];
    delete process.env['GHL_VOICE_DISCOVER_CONVERSATION_LIMIT'];
    orchestrate.mockResolvedValue({ outcome: 'SKIP' });
    mockAudioTranscription.transcribeRemoteMedia.mockImplementation(async () => ({
      ok: true as const,
      transcript: 'voice transcript',
      mediaBytes: 12,
      contentType: 'audio/mpeg',
    }));
    mockGhlVoiceRecordingFetch.tryFetchRecording.mockImplementation(async () => ({
      ok: false as const,
      reason: 'test_disabled',
    }));
    mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId.mockImplementation(async () => ({
      ok: false as const,
      reason: 'test_skipped',
    }));
    mockGhlVoiceConversationDiscovery.discoverConversationIdByContact.mockImplementation(async () => ({
      ok: false as const,
      reason: 'test_skipped',
    }));
    processor = new InboundMessageProcessor(
      mockOrchestration as never,
      mockResetService as never,
      mockInboundAutoTagging as never,
      mockAudioTranscription as never,
      mockGhlVoiceRecordingFetch as never,
      mockGhlVoiceMessageDiscovery as never,
      mockGhlVoiceConversationDiscovery as never,
      mockFollowUpEngine as never,
      mockHumanEscalationHolding as never,
      { add: mockSendBubbleQueueAdd } as never,
      { add: mockInboundQueueAdd } as never,
    );
  });

  it('persist stores inbound and schedules orchestrate with default debounce delay and versioned jobId', async () => {
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
        delay: 2000,
        jobId: `deb:${CONV_ID}:1`,
      }),
    );
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('persist schedules orchestrate delay from AISBP_INBOUND_DEBOUNCE_MS when set', async () => {
    process.env[INBOUND_DEBOUNCE_ENV_KEY] = '4300';
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
      expect.any(Object),
      expect.objectContaining({ delay: 4300 }),
    );
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
    expect(mockInboundAutoTagging.evaluateAndApplyAutoTags).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      conversationId: CONV_ID,
      contactId: 'ct_1',
      ghlLocationId: 'loc_1',
      messageText: 'Menu?\n\nActually mains',
    });
  });

  it('orchestrate: SKIP_HANDOVER_ACTIVE triggers holding reply service (no normal send plan)', async () => {
    orchestrate.mockResolvedValueOnce({
      success: false,
      outcome: 'SKIP_HANDOVER_ACTIVE',
      conversationId: CONV_ID,
      guards: { final: 'SKIP_HANDOVER_ACTIVE', guards: [] },
    } as never);
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
              data: [{ content: 'Hello?', created_at: '2026-01-01T00:00:01.000Z' }],
              error: null,
            }),
        };
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'tenant-1', bot_mode: 'autopilot' },
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
        debounceVersion: 4,
      }),
    );

    expect(mockHumanEscalationHolding.tryEnqueueHoldingReply).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: CONV_ID,
        locationId: 'loc_1',
        ghlContactId: 'ct_1',
        latestInboundText: 'Hello?',
      }),
    );
    expect(mockSendBubbleQueueAdd).not.toHaveBeenCalled();
  });

  it('orchestrate: exact /new triggers reset service and skips AI orchestration', async () => {
    mockResetService.evaluateChatResetEligibility.mockResolvedValue({
      allowed: true,
      allowEnvValue: 'true',
      tenantSettingValue: undefined,
      whitelistConfigured: false,
      contactMatchedWhitelist: true,
    });
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
    expect(mockResetService.clearHandoverAfterAllowedReset).toHaveBeenCalledWith(CONV_ID, 'tenant-1');
    expect(orchestrate).not.toHaveBeenCalled();
    expect(mockSendBubbleQueueAdd).toHaveBeenCalled();
    expect(mockInboundAutoTagging.evaluateAndApplyAutoTags).not.toHaveBeenCalled();
  });

  it('orchestrate: /new when reset disabled falls through to normal orchestration', async () => {
    mockResetService.evaluateChatResetEligibility.mockResolvedValue({
      allowed: false,
      deniedReason: 'env_disabled',
      allowEnvValue: 'false',
      tenantSettingValue: undefined,
      whitelistConfigured: false,
      contactMatchedWhitelist: true,
    });
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
    expect(mockResetService.clearHandoverAfterAllowedReset).not.toHaveBeenCalled();
    expect(orchestrate).toHaveBeenCalled();
  });

  it('orchestrate: /new denied when tenant_disabled still runs normal orchestration', async () => {
    mockResetService.evaluateChatResetEligibility.mockResolvedValue({
      allowed: false,
      deniedReason: 'tenant_disabled',
      allowEnvValue: 'true',
      tenantSettingValue: false,
      whitelistConfigured: false,
      contactMatchedWhitelist: true,
    });
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
    expect(mockResetService.clearHandoverAfterAllowedReset).not.toHaveBeenCalled();
    expect(orchestrate).toHaveBeenCalled();
  });

  it('orchestrate: uses last batch message for command (multi-line batch)', async () => {
    mockResetService.evaluateChatResetEligibility.mockResolvedValue({
      allowed: true,
      allowEnvValue: 'true',
      tenantSettingValue: undefined,
      whitelistConfigured: false,
      contactMatchedWhitelist: true,
    });
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
              // DB returns newest-first; burst batch is oldest→newest so last = latest inbound.
              data: [
                { content: '/new', created_at: '2026-01-01T00:00:02.000Z' },
                { content: 'menu pls', created_at: '2026-01-01T00:00:01.000Z' },
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

    expect(mockResetService.performBotStateReset).toHaveBeenCalledWith(
      expect.objectContaining({ resetCommand: '/new' }),
    );
    expect(mockResetService.clearHandoverAfterAllowedReset).toHaveBeenCalledWith(CONV_ID, 'tenant-1');
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('orchestrate: when reset is denied, AI batch excludes /new but still runs on prior lines', async () => {
    mockResetService.evaluateChatResetEligibility.mockResolvedValue({
      allowed: false,
      deniedReason: 'env_disabled',
      allowEnvValue: 'false',
      tenantSettingValue: undefined,
      whitelistConfigured: false,
      contactMatchedWhitelist: true,
    });
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
              data: [
                { content: '/new', created_at: '2026-01-01T00:00:02.000Z' },
                { content: 'hello', created_at: '2026-01-01T00:00:01.000Z' },
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

    expect(mockResetService.performBotStateReset).not.toHaveBeenCalled();
    expect(orchestrate).toHaveBeenCalled();
    const arg = orchestrate.mock.calls[0]![0] as { recentInboundBatch?: string[]; incomingMessage?: { messageContent?: string } };
    expect(arg.recentInboundBatch).toEqual(['hello']);
    expect(arg.incomingMessage?.messageContent).toBe('hello');
    expect(arg.recentInboundBatch?.includes('/new')).toBe(false);
  });

  it('persist: audio with media URL transcribes and stores transcript as message text', async () => {
    let inserted: Record<string, unknown> | null = null;
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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    mockAudioTranscription.transcribeRemoteMedia.mockResolvedValueOnce({
      ok: true,
      transcript: 'Please book me for Saturday',
      mediaBytes: 100,
      contentType: 'audio/mpeg',
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_1',
        ghlContactId: 'ct_1',
        messageContent: '',
        messageType: 'audio',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        audioMediaUrl: 'https://cdn.example.com/voice.m4a',
        voiceInboundNeedsTranscribe: true,
      }),
    );

    expect(mockAudioTranscription.transcribeRemoteMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        mediaUrl: 'https://cdn.example.com/voice.m4a',
      }),
    );
    expect(inserted?.['content']).toBe('Please book me for Saturday');
    expect(inserted?.['contentType']).toBe('TEXT');
    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceTranscriptionStatus']).toBe('succeeded');
    expect(meta?.['inboundVoiceNote']).toBe(true);
  });

  it('persist: empty body + attachment path transcribes when voice flag is set', async () => {
    let inserted: Record<string, unknown> | null = null;
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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_1',
        ghlContactId: 'ct_1',
        messageContent: '',
        messageType: 'unknown',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        audioMediaUrl: 'https://cdn.example.com/note.mp3',
        voiceInboundNeedsTranscribe: true,
      }),
    );

    expect(mockAudioTranscription.transcribeRemoteMedia).toHaveBeenCalled();
    expect(inserted?.['content']).toBe('voice transcript');
  });

  it('persist: transcription failure stores safe fallback text', async () => {
    let inserted: Record<string, unknown> | null = null;
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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    mockAudioTranscription.transcribeRemoteMedia.mockResolvedValueOnce({
      ok: false,
      errorCode: 'openai_500',
      userFacingFallback: true,
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_1',
        ghlContactId: 'ct_1',
        messageContent: '',
        messageType: 'audio',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        audioMediaUrl: 'https://cdn.example.com/bad.m4a',
        voiceInboundNeedsTranscribe: true,
      }),
    );

    expect(inserted?.['content']).toBe(VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE);
    expect((inserted?.['metadata'] as Record<string, unknown>)?.['voiceTranscriptionStatus']).toBe('failed');
  });

  it('persist: normal text inbound does not call transcription', async () => {
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

    expect(mockAudioTranscription.transcribeRemoteMedia).not.toHaveBeenCalled();
  });

  it('persist: GHL placeholder-without-media skips transcription and sets metadata', async () => {
    let inserted: Record<string, unknown> | null = null;
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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_1',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
      }),
    );

    expect(mockAudioTranscription.transcribeRemoteMedia).not.toHaveBeenCalled();
    expect(inserted?.['content']).toBe(VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE);
    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceInboundAudioPlaceholderWithoutMediaUrl']).toBe(true);
    expect(meta?.['inboundVoiceNote']).toBe(true);
    expect(meta?.['voiceTranscriptionStatus']).toBe('media_url_missing');
  });

  it('persist: feature-flag recording fetch + buffer transcribe skips placeholder fallback', async () => {
    const prev = process.env['GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID'];
    process.env['GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID'] = 'true';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceRecordingFetch.tryFetchRecording.mockResolvedValue({
      ok: true,
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'audio/mpeg',
    });
    mockAudioTranscription.transcribeAudioBuffer.mockResolvedValue({
      ok: true as const,
      transcript: 'from ghl recording api',
      mediaBytes: 3,
      contentType: 'audio/mpeg',
    });

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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    try {
      await processor.process(
        makeJob('persist', {
          locationId: 'loc_1',
          ghlConversationId: 'ghl_conv_1',
          ghlContactId: 'ct_1',
          messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
          messageType: 'text',
          timestamp: '2026-01-01T00:00:00Z',
          smokeImmediate: false,
          voiceInboundNeedsTranscribe: false,
          voiceInboundAudioPlaceholderWithoutMediaUrl: true,
          voiceInboundPlaceholderRawBody: 'AUDIO',
          ghlInboundMessageId: 'ghl_msg_rec_1',
        }),
      );

      expect(mockGhlVoiceRecordingFetch.tryFetchRecording).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        locationId: 'loc_1',
        messageId: 'ghl_msg_rec_1',
      });
      expect(mockAudioTranscription.transcribeAudioBuffer).toHaveBeenCalled();
      expect(mockAudioTranscription.transcribeRemoteMedia).not.toHaveBeenCalled();
      expect(inserted?.['content']).toBe('from ghl recording api');
      const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
      expect(meta?.['voiceTranscriptionStatus']).toBe('succeeded');
      expect(meta?.['voiceRecordingFetchedFromGhl']).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env['GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID'];
      } else {
        process.env['GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID'] = prev;
      }
    }
  });

  it('persist: Phase 1C discovery + recording + transcribe when webhook has no messageId', async () => {
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';
    process.env['GHL_VOICE_DISCOVER_MAX_ATTEMPTS'] = '1';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId.mockResolvedValue({
      ok: true,
      messageId: 'ghl_discovered_msg',
      candidateCount: 2,
    });
    mockGhlVoiceRecordingFetch.tryFetchRecording.mockResolvedValue({
      ok: true,
      buffer: Buffer.from([9, 9]),
      contentType: 'audio/mpeg',
    });
    mockAudioTranscription.transcribeAudioBuffer.mockResolvedValue({
      ok: true as const,
      transcript: 'from discovery path',
      mediaBytes: 2,
      contentType: 'audio/mpeg',
    });

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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_disc',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
        voiceInboundPlaceholderRawBody: '>AUDIO<',
      }),
    );

    expect(mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        locationId: 'loc_1',
        conversationId: 'ghl_conv_disc',
        placeholderKind: 'AUDIO',
      }),
    );
    expect(mockGhlVoiceRecordingFetch.tryFetchRecording).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      locationId: 'loc_1',
      messageId: 'ghl_discovered_msg',
    });
    expect(inserted?.['content']).toBe('from discovery path');
    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceRetrievalMethod']).toBe('ghl_message_discovery_recording_fetch');
    expect(meta?.['voiceDiscoveredMessageId']).toBe(true);
    expect(meta?.['voiceTranscriptionStatus']).toBe('succeeded');
  });

  it('persist: discovery finds no message id — safe fallback + metadata', async () => {
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId.mockResolvedValue({
      ok: false,
      reason: 'message_id_not_found',
      candidateCount: 0,
    });

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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_x',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'VOICE',
        voiceInboundPlaceholderRawBody: '>VOICE<',
      }),
    );

    expect(mockGhlVoiceRecordingFetch.tryFetchRecording).not.toHaveBeenCalled();
    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceDiscoveredMessageId']).toBe(false);
    expect(meta?.['voiceRetrievalFailureReason']).toBe('message_id_not_found');
    expect(meta?.['voiceTranscriptionStatus']).toBe('media_url_missing');
  });

  it('persist: discovery id but recording 404 — fallback with failure reason', async () => {
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId.mockResolvedValue({
      ok: true,
      messageId: 'mid_404',
      candidateCount: 1,
    });
    mockGhlVoiceRecordingFetch.tryFetchRecording.mockResolvedValue({
      ok: false as const,
      reason: 'http_404',
    });

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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_404',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
        voiceInboundPlaceholderRawBody: '>AUDIO<',
      }),
    );

    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceDiscoveredMessageId']).toBe(true);
    expect(meta?.['voiceRetrievalFailureReason']).toBe('http_404');
    expect(meta?.['voiceTranscriptionStatus']).toBe('media_url_missing');
  });

  it('persist: discovery id but recording 422 — voiceRetrievalFailureReason recording_fetch_http_422', async () => {
    process.env['GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId.mockResolvedValue({
      ok: true,
      messageId: 'mid_422',
      candidateCount: 1,
    });
    mockGhlVoiceRecordingFetch.tryFetchRecording.mockResolvedValue({
      ok: false as const,
      reason: 'http_422',
    });

    let inserted: Record<string, unknown> | null = null;
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
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_422',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
        voiceInboundPlaceholderRawBody: '>AUDIO<',
      }),
    );

    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceRetrievalFailureReason']).toBe('recording_fetch_http_422');
    expect(meta?.['voiceTranscriptionStatus']).toBe('media_url_missing');
  });

  it('persist: normal text does not run message-id discovery', async () => {
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';

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
        messageContent: 'Hello there',
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
      }),
    );

    expect(mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId).not.toHaveBeenCalled();
    expect(mockGhlVoiceConversationDiscovery.discoverConversationIdByContact).not.toHaveBeenCalled();
  });

  it('persist: Phase 1D no conversationId -> conversation+message discovery -> recording -> transcript', async () => {
    process.env['GHL_VOICE_DISCOVER_CONVERSATION_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_CONVERSATION_LIMIT'] = '10';
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceConversationDiscovery.discoverConversationIdByContact.mockResolvedValue({
      ok: true,
      conversationId: 'disc_conv_1',
      candidateCount: 3,
    });
    mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId.mockResolvedValue({
      ok: true,
      messageId: 'disc_msg_1',
      candidateCount: 2,
    });
    mockGhlVoiceRecordingFetch.tryFetchRecording.mockResolvedValue({
      ok: true,
      buffer: Buffer.from([5, 6]),
      contentType: 'audio/mpeg',
    });
    mockAudioTranscription.transcribeAudioBuffer.mockResolvedValue({
      ok: true as const,
      transcript: 'phase1d transcript',
      mediaBytes: 2,
      contentType: 'audio/mpeg',
    });

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
      if (table === 'conversations') return makeConversationsTableMock({ id: CONV_ID });
      if (table === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: '',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
        voiceInboundPlaceholderRawBody: '>AUDIO<',
      }),
    );

    expect(mockGhlVoiceConversationDiscovery.discoverConversationIdByContact).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      locationId: 'loc_1',
      contactId: 'ct_1',
    });
    expect(mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'disc_conv_1',
      }),
    );
    expect(mockGhlVoiceRecordingFetch.tryFetchRecording).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      locationId: 'loc_1',
      messageId: 'disc_msg_1',
    });
    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(inserted?.['content']).toBe('phase1d transcript');
    expect(meta?.['voiceRetrievalMethod']).toBe(
      'ghl_conversation_discovery_message_discovery_recording_fetch',
    );
    expect(meta?.['voiceDiscoveredConversationId']).toBe(true);
    expect(meta?.['voiceDiscoveredMessageId']).toBe(true);
    expect(meta?.['voiceTranscriptionStatus']).toBe('succeeded');
  });

  it('persist: no conversationId -> discovery returns direct audio URL -> transcribeRemoteMedia path', async () => {
    process.env['GHL_VOICE_DISCOVER_CONVERSATION_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceConversationDiscovery.discoverConversationIdByContact.mockResolvedValue({
      ok: true,
      conversationId: 'disc_conv_2',
      candidateCount: 1,
    });
    mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId.mockResolvedValue({
      ok: true,
      messageId: 'disc_msg_2',
      audioMediaUrl: 'https://storage.googleapis.com/stark-media/p/file.mp3',
      candidateReason: 'inbound_with_direct_audio_url',
      candidateCount: 1,
    });
    mockAudioTranscription.transcribeRemoteMedia.mockResolvedValue({
      ok: true as const,
      transcript: 'direct media transcript',
      mediaBytes: 14,
      contentType: 'audio/mpeg',
    });

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
      if (table === 'conversations') return makeConversationsTableMock({ id: CONV_ID });
      if (table === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: '',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
      }),
    );

    expect(mockAudioTranscription.transcribeRemoteMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        mediaUrl: 'https://storage.googleapis.com/stark-media/p/file.mp3',
      }),
    );
    expect(mockGhlVoiceRecordingFetch.tryFetchRecording).not.toHaveBeenCalled();
    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(inserted?.['content']).toBe('direct media transcript');
    expect(meta?.['voiceRetrievalMethod']).toBe('ghl_message_history_direct_media_url');
    expect(meta?.['voiceDiscoveredConversationId']).toBe(true);
    expect(meta?.['voiceDiscoveredMessageId']).toBe(true);
  });

  it('persist: conversation discovery none -> fallback with conversation_id_not_found', async () => {
    process.env['GHL_VOICE_DISCOVER_CONVERSATION_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceConversationDiscovery.discoverConversationIdByContact.mockResolvedValue({
      ok: false,
      reason: 'conversation_id_not_found',
      candidateCount: 0,
    });

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
      if (table === 'conversations') return makeConversationsTableMock({ id: CONV_ID });
      if (table === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: '',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
      }),
    );

    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceDiscoveredConversationId']).toBe(false);
    expect(meta?.['voiceDiscoveredMessageId']).toBe(false);
    expect(meta?.['voiceRetrievalFailureReason']).toBe('conversation_id_not_found');
    expect(meta?.['voiceTranscriptionStatus']).toBe('media_url_missing');
  });

  it('persist: conversation discovery 401/403 fallback safely', async () => {
    process.env['GHL_VOICE_DISCOVER_CONVERSATION_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceConversationDiscovery.discoverConversationIdByContact.mockResolvedValue({
      ok: false,
      reason: 'http_401',
      candidateCount: 0,
    });

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
      if (table === 'conversations') return makeConversationsTableMock({ id: CONV_ID });
      if (table === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: '',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'VOICE',
      }),
    );

    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceRetrievalFailureReason']).toBe('http_401');
    expect(meta?.['voiceTranscriptionStatus']).toBe('media_url_missing');
  });

  it('persist: message discovery returns no id and no URL -> safe fallback reason', async () => {
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    let inserted: Record<string, unknown> | null = null;
    mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId.mockResolvedValue({
      ok: false,
      reason: 'audio_media_url_not_found',
      candidateCount: 1,
    });

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
      if (table === 'conversations') return makeConversationsTableMock({ id: CONV_ID });
      if (table === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_x',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
      }),
    );

    const meta = inserted?.['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['voiceRetrievalFailureReason']).toBe('audio_media_url_not_found');
    expect(meta?.['voiceTranscriptionStatus']).toBe('media_url_missing');
  });

  it('persist: conversationId already present -> conversation discovery not called', async () => {
    process.env['GHL_VOICE_DISCOVER_CONVERSATION_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

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
      if (table === 'conversations') return makeConversationsTableMock({ id: CONV_ID });
      if (table === 'messages') return { insert: () => ({ error: null }) };
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'existing_conv',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
      }),
    );

    expect(mockGhlVoiceConversationDiscovery.discoverConversationIdByContact).not.toHaveBeenCalled();
  });

  it('persist: placeholder with media URL does not run conversation discovery', async () => {
    process.env['GHL_VOICE_DISCOVER_CONVERSATION_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

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
      if (table === 'conversations') return makeConversationsTableMock({ id: CONV_ID });
      if (table === 'messages') return { insert: () => ({ error: null }) };
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: '',
        ghlContactId: 'ct_1',
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderKind: 'AUDIO',
        audioMediaUrl: 'https://cdn.example.com/voice.m4a',
      }),
    );

    expect(mockGhlVoiceConversationDiscovery.discoverConversationIdByContact).not.toHaveBeenCalled();
  });

  it('persist: placeholder with direct webhook media URL uses existing transcribeRemoteMedia path', async () => {
    let inserted: Record<string, unknown> | null = null;
    mockAudioTranscription.transcribeRemoteMedia.mockResolvedValue({
      ok: true as const,
      transcript: 'from webhook media url',
      mediaBytes: 7,
      contentType: 'audio/mpeg',
    });
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
      if (table === 'conversations') return makeConversationsTableMock({ id: CONV_ID });
      if (table === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      }
      return {} as never;
    });

    await processor.process(
      makeJob('persist', {
        locationId: 'loc_1',
        ghlConversationId: 'ghl_conv_1',
        ghlContactId: 'ct_1',
        messageContent: '',
        messageType: 'audio',
        audioMediaUrl: 'https://cdn.example.com/inbound.webm',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: true,
      }),
    );

    expect(mockAudioTranscription.transcribeRemoteMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaUrl: 'https://cdn.example.com/inbound.webm',
      }),
    );
    expect(mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId).not.toHaveBeenCalled();
    expect(mockGhlVoiceConversationDiscovery.discoverConversationIdByContact).not.toHaveBeenCalled();
    expect(inserted?.['content']).toBe('from webhook media url');
  });

  it('persist: placeholder with webhook messageId uses direct recording fetch, not discovery', async () => {
    process.env['GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_MESSAGE_ID'] = 'true';
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';

    mockGhlVoiceRecordingFetch.tryFetchRecording.mockResolvedValue({
      ok: true,
      buffer: Buffer.from([1]),
      contentType: 'audio/mpeg',
    });
    mockAudioTranscription.transcribeAudioBuffer.mockResolvedValue({
      ok: true as const,
      transcript: 'direct id path',
      mediaBytes: 1,
      contentType: 'audio/mpeg',
    });

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
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        messageType: 'text',
        timestamp: '2026-01-01T00:00:00Z',
        smokeImmediate: false,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
        voiceInboundPlaceholderRawBody: 'AUDIO',
        ghlInboundMessageId: 'webhook_msg_direct',
      }),
    );

    expect(mockGhlVoiceMessageDiscovery.discoverVoicePlaceholderMessageId).not.toHaveBeenCalled();
    expect(mockGhlVoiceRecordingFetch.tryFetchRecording).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      locationId: 'loc_1',
      messageId: 'webhook_msg_direct',
    });
  });
});
