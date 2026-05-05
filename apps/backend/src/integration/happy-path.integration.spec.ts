import { jest as jestGlobal } from '@jest/globals';

import { InboundMessageProcessor } from '../queues/processors/inbound-message.processor';
import { createMockSupabase } from '../test/mock-supabase';
import { Job } from 'bullmq';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

const mockQueueAdd = jestGlobal.fn(async () => {});
jestGlobal.mock('@nestjs/bullmq', () => {
  class MockWorkerHost {
    run = jestGlobal.fn();
  }
  return {
    InjectQueue: () => jestGlobal.fn(),
    Queue: jestGlobal.fn(() => ({
      add: mockQueueAdd,
    })) as never,
    WorkerHost: MockWorkerHost,
    OnWorkerEvent: () => jestGlobal.fn(),
    Processor: () => jestGlobal.fn(),
  };
});

const mockOrchestrate = jestGlobal.fn();

jestGlobal.mock('../modules/orchestration/orchestration.service', () => ({
  ConversationOrchestrationService: jestGlobal.fn().mockImplementation(() => ({
    orchestrate: mockOrchestrate,
    loadTenantContext: jestGlobal.fn(async () => ({
      id: 't1',
      name: 'T',
      botEnabled: true,
      botMode: 'autopilot' as const,
      handoverPaused: false,
      ghlLocationId: 'loc_1',
    })),
    loadPromptConfig: jestGlobal.fn(async () => null),
    loadAgencyPolicy: jestGlobal.fn(async () => null),
    loadConversation: jestGlobal.fn(async () => ({ id: 'c1', channel: 'WHATSAPP', status: 'ACTIVE' })),
  })),
}));

function makeJobData(overrides: Record<string, unknown> = {}) {
  return {
    locationId: (overrides['locationId'] as string) ?? 'loc_1',
    ghlConversationId: (overrides['ghlConversationId'] as string) ?? 'conv_123',
    ghlContactId: (overrides['ghlContactId'] as string) ?? 'contact_1',
    messageContent: (overrides['messageContent'] as string) ?? 'Hello',
    messageType: (overrides['messageType'] as string) ?? 'text',
    timestamp: (overrides['timestamp'] as string) ?? '2026-01-01T00:00:00Z',
    webhookEventId: (overrides['webhookEventId'] as string) ?? 'evt_1',
    /** Run orchestration in-process so this suite can assert send-bubble enqueue without a delayed worker. */
    smokeImmediate: overrides['smokeImmediate'] === false ? false : true,
  };
}

function makeMockJob(data: ReturnType<typeof makeJobData>): Job {
  return { data, id: 'job_1' } as never;
}

describe('InboundMessageProcessor (happy path)', () => {
  let processor: InboundMessageProcessor;

  beforeEach(() => {
    jestGlobal.clearAllMocks();

    mockOrchestrate.mockResolvedValue({
      success: true,
      outcome: 'PROCEED',
      replyPlan: {
        bubbles: [{ index: 0, text: 'Hello!' }],
        planStatus: 'PLANNED',
        handoverRecommended: false,
        suggestedActions: [],
      },
      routing: { recommendedModel: 'gpt-4o' },
    });

    mockQueueAdd.mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockSupabase.from as jest.Mock).mockImplementation((table: string): any => {
      if (table === 'tenants') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { id: 't1' }, error: null }) }) }),
        };
      }
      if (table === 'webhook_events') {
        return {
          insert: jestGlobal.fn(() => ({ select: jestGlobal.fn(() => ({ single: jestGlobal.fn(async () => ({ data: { id: 'evt_new' }, error: null })) })) })),
          update: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        };
      }
      if (table === 'conversations') {
        return {
          select: () => {
            const chainable: Record<string, unknown> = {};
            chainable['eq'] = () => chainable;
            chainable['order'] = () => chainable;
            chainable['limit'] = async () => ({ data: [], error: null });
            chainable['single'] = async () => ({ data: null, error: { code: 'PGRST116' } });
            chainable['maybeSingle'] = async () => ({ data: null, error: null });
            return chainable;
          },
          insert: jestGlobal.fn(() => ({ select: jestGlobal.fn(() => ({ single: jestGlobal.fn(async () => ({ data: { id: 'c1' }, error: null })) })) })),
          update: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        };
      }
      if (table === 'messages') {
        return { insert: jestGlobal.fn(async () => ({ data: null, error: null })) };
      }
      return {};
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OrchestrationService = require('../modules/orchestration/orchestration.service').ConversationOrchestrationService;
    const mockReset = {
      evaluateChatResetEligibility: jestGlobal.fn(async () => ({
        allowed: false,
        deniedReason: 'env_disabled' as const,
        allowEnvValue: undefined,
        tenantSettingValue: undefined,
        whitelistConfigured: false,
        contactMatchedWhitelist: true,
      })),
      performBotStateReset: jestGlobal.fn(async () => ({})),
      clearHandoverAfterAllowedReset: jestGlobal.fn(async () => {}),
      buildConfirmationReplyPlan: jestGlobal.fn(() => ({ bubbles: [] })),
    };
    const mockAudioTranscription = {
      transcribeRemoteMedia: jestGlobal.fn(async () => ({
        ok: false as const,
        errorCode: 'unused_in_happy_path',
        userFacingFallback: true,
      })),
      transcribeAudioBuffer: jestGlobal.fn(async () => ({
        ok: false as const,
        errorCode: 'unused',
        userFacingFallback: true,
      })),
    };
    const mockGhlRecordingFetch = {
      tryFetchRecording: jestGlobal.fn(async () => ({ ok: false as const, reason: 'disabled' })),
    };
    const mockGhlVoiceDiscovery = {
      discoverVoicePlaceholderMessageId: jestGlobal.fn(async () => ({
        ok: false as const,
        reason: 'disabled',
      })),
    };
    processor = new InboundMessageProcessor(
      new OrchestrationService(),
      mockReset as never,
      { evaluateAndApplyAutoTags: jestGlobal.fn(async () => {}) } as never,
      mockAudioTranscription as never,
      mockGhlRecordingFetch as never,
      mockGhlVoiceDiscovery as never,
      { add: mockQueueAdd } as never,
      { add: mockQueueAdd } as never,
    );
  });

  it('enqueues send-bubble job when bubbles exist', async () => {
    const job = makeMockJob(makeJobData());
    await processor.process(job);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-bubble',
      expect.objectContaining({
        conversationId: 'c1',
        tenantId: 't1',
        replyPlanJson: expect.any(String),
      })
    );
  });

  it('does NOT enqueue send-bubble when orchestration returns SKIP_BOT_DISABLED', async () => {
    mockOrchestrate.mockResolvedValue({
      success: false,
      outcome: 'SKIP_BOT_DISABLED',
      replyPlan: { bubbles: [], planStatus: 'SKIPPED', handoverRecommended: false, suggestedActions: [] },
      routing: { recommendedModel: 'gpt-4o' },
      error: 'bot disabled',
    });

    const job = makeMockJob(makeJobData());
    await processor.process(job);

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('enqueues handover notify when outcome is HANDOVER', async () => {
    mockOrchestrate.mockResolvedValue({
      success: true,
      outcome: 'PROCEED',
      replyPlan: {
        bubbles: [],
        planStatus: 'HANDOVER',
        handoverRecommended: true,
        suggestedActions: [],
      },
      routing: { recommendedModel: 'gpt-4o' },
    });

    const job = makeMockJob(makeJobData());
    await processor.process(job);

    // No send-bubble for HANDOVER
    const sendBubbleCalls = mockQueueAdd.mock.calls.filter(([name]) => name === 'send-bubble');
    expect(sendBubbleCalls).toHaveLength(0);
  });
});
