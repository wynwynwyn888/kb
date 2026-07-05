// Send-bubble processor tests — provider done-after-send and decision recording
import { jest as jestGlobal } from '@jest/globals';
import type { Job } from 'bullmq';

// Mock NestJS infrastructure (must be before any imports)
jestGlobal.mock('@nestjs/config', () => ({ ConfigService: class {}, ConfigModule: {} }));
jestGlobal.mock('@nestjs/bullmq', () => ({
  Processor: () => (t: unknown) => t,
  WorkerHost: class { process(_job: unknown): unknown { return {}; } },
  InjectQueue: () => () => undefined,
  OnWorkerEvent: () => () => undefined,
}));
jestGlobal.mock('@nestjs/common', () => ({
  Injectable: () => (t: unknown) => t,
  Logger: class { log = jestGlobal.fn(); warn = jestGlobal.fn(); error = jestGlobal.fn(); debug = jestGlobal.fn(); } as any,
  Optional: () => (t: unknown) => t,
}));

// Mock all service dependencies (prevent import chains from pulling in NestJS)
jestGlobal.mock('../../lib/app-cache.service', () => ({ AppCacheService: class {} }));
jestGlobal.mock('../../lib/metrics.service', () => ({ MetricsService: class {} }));
jestGlobal.mock('../../modules/conversations/conversations.service', () => ({ ConversationsService: class {} }));
jestGlobal.mock('../../modules/action-gating/action-gating.service', () => ({ ActionGatingService: class {} }));
jestGlobal.mock('../../modules/action-execution/action-intent-executor.service', () => ({ ActionIntentExecutorService: class {} }));
jestGlobal.mock('../../modules/outbound/outbound-safety-governor.service', () => ({ OutboundSafetyGovernorService: class {} }));
jestGlobal.mock('../../modules/follow-up-engine/follow-up-engine.service', () => ({ FollowUpEngineService: class {} }));
jestGlobal.mock('../../modules/human-escalation/human-escalation-runtime.service', () => ({ HumanEscalationRuntimeService: class {} }));
jestGlobal.mock('../../modules/human-escalation/human-escalation-holding-reply.service', () => ({ HumanEscalationHoldingReplyService: class {} }));
jestGlobal.mock('../../modules/outbound/outbound-send.service', () => ({
  OutboundSendService: class {
    sendReply = mockSendReplyGlobal();
    isReplyStale = mockIsReplyStaleGlobal();
  },
}));

// Mocks for lib functions
const mockRecordTerminalDecision = jestGlobal.fn(async () => true);
const mockRecordInterimDecision = jestGlobal.fn(async () => {});
jestGlobal.mock('../../lib/inbound-decision', () => ({
  recordTerminalDecision: mockRecordTerminalDecision,
  recordInterimDecision: mockRecordInterimDecision,
}));

const mockMarkProviderOrchestrationDone = jestGlobal.fn(async () => {});
jestGlobal.mock('../../lib/schedule-orchestration-if-new', () => ({
  markProviderOrchestrationDone: mockMarkProviderOrchestrationDone,
  checkProviderOrchestrationGate: jestGlobal.fn(),
  releaseProviderLock: jestGlobal.fn(),
}));

const mockSupabaseFrom = jestGlobal.fn();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({ from: mockSupabaseFrom }),
}));

jestGlobal.mock('../../lib/inbound-debounce', () => ({
  bumpInboundDebounceMeta: jestGlobal.fn(() => ({ merged: {}, newVersion: 1 })),
  shouldSkipStaleDebounceJob: jestGlobal.fn(() => false),
}));
jestGlobal.mock('../../lib/inbound-burst-batch', () => ({
  resolveInboundDebounceMs: jestGlobal.fn(() => ({ debounceMs: 2000, debounceSource: 'default' })),
}));
jestGlobal.mock('../../lib/conversation-metadata-merge', () => ({
  readConversationMetadataField: jestGlobal.fn(() => ({})),
  mergeConversationMetadataForPersist: jestGlobal.fn(() => ({})),
}));

// Global mock functions referenced by the OutboundSendService class mock
function mockSendReplyGlobal() { return jestGlobal.fn(); }
function mockIsReplyStaleGlobal() { return jestGlobal.fn(async () => false); }

import { SendBubbleProcessor } from './send-bubble.processor';

function makeJob(overrides: Partial<{
  providerGhlMessageId: string;
  inboundMessageId: string;
  conversationId: string;
  tenantId: string;
  replyId: string;
}> = {}): Job {
  return {
    id: 'job-1',
    name: 'send-bubble',
    opts: { jobId: 'sb-1' },
    data: {
      conversationId: overrides.conversationId ?? 'conv1',
      tenantId: overrides.tenantId ?? 't1',
      contactId: 'c1',
      ghlLocationId: 'loc1',
      replyPlanJson: JSON.stringify({
        planStatus: 'PLANNED',
        bubbles: [{ index: 0, text: 'Hello from AI' }],
        responseMode: 'standard',
        handoverRecommended: false,
        confidence: 0.9,
        rationale: 'test',
        suggestedActions: [],
        draftProvenance: 'live_generation',
      }),
      replyId: overrides.replyId ?? 'reply-1',
      bubbleSequence: 0,
      latestInboundMsgIdAtStart: 'inbound-1',
      aiJobStartedAt: Date.now(),
      providerGhlMessageId: overrides.providerGhlMessageId ?? 'ghl-msg-1',
      inboundMessageId: overrides.inboundMessageId ?? 'kb-msg-1',
    },
  } as any;
}

describe('SendBubbleProcessor — provider done-after-send', () => {
  let processor: SendBubbleProcessor;
  let mockSendReply: ReturnType<typeof jestGlobal.fn>;
  let mockIsReplyStale: ReturnType<typeof jestGlobal.fn>;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockRecordTerminalDecision.mockResolvedValue(true);
    mockMarkProviderOrchestrationDone.mockResolvedValue(undefined);

    mockSendReply = jestGlobal.fn();
    mockIsReplyStale = jestGlobal.fn(async () => false);

    // Override the class mock's method references with fresh fns
    (SendBubbleProcessor as any).prototype._mockSendReply = mockSendReply;

    mockSupabaseFrom.mockReturnValue({
      select: jestGlobal.fn(() => ({
        eq: jestGlobal.fn(() => ({
          single: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
          maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
        })),
      })),
      update: jestGlobal.fn(() => ({
        eq: jestGlobal.fn(async () => ({ error: null })),
      })),
    });

    const mockInboundQueueAdd = jestGlobal.fn();

    // Create a processor with mocked services.
    // Since OutboundSendService is a mocked class, we pass an instance stub.
    const outboundSendStub = {
      sendReply: mockSendReply,
      isReplyStale: mockIsReplyStale,
    };

    mockSendReply.mockResolvedValue({
      conversationId: 'conv1', tenantId: 't1',
      totalBubbles: 1, succeeded: 1, failed: 0,
      bubbleResults: [{ index: 0, text: 'Hello', success: true, ghlMessageId: 'ghl-out-1' }],
      quotaDebited: 0,
    });

    const mockAppCache = { acquireLock: jestGlobal.fn(), releaseLock: jestGlobal.fn(), redis: { exists: jestGlobal.fn(), set: jestGlobal.fn() } } as any;

    processor = new SendBubbleProcessor(
      outboundSendStub as any,
      {} as any,
      {} as any,
      { shouldExecute: () => false, executeDeferredTagActions: async () => [], executeDeferredBookSlotActions: async () => [] } as any,
      { applyOutboundGovernor: jestGlobal.fn((plan: any) => plan) } as any,
      { scheduleAfterOutboundSend: jestGlobal.fn(async () => {}) } as any,
      {} as any,
      {} as any,
      { add: mockInboundQueueAdd } as any,
      { add: jestGlobal.fn() } as any,
      { add: jestGlobal.fn(), remove: jestGlobal.fn(async () => {}) } as any,
      mockAppCache,
      undefined,
    );
  });

  // ── Test 1: Successful send → decision before provider done ──────────
  it('records PROCEED before marking provider done on successful send', async () => {
    let callOrder: string[] = [];
    mockRecordTerminalDecision.mockImplementation(async () => { callOrder.push('decision'); return true; });
    mockMarkProviderOrchestrationDone.mockImplementation(async () => { callOrder.push('done'); });

    await processor.process(makeJob());

    expect(mockRecordTerminalDecision).toHaveBeenCalledTimes(1);
    expect(mockMarkProviderOrchestrationDone).toHaveBeenCalledTimes(1);

    const decisionCall = mockRecordTerminalDecision.mock.calls[0][0];
    expect(decisionCall.decision.status).toBe('PROCEED');
    expect(decisionCall.decision.outboundMessageId).toBe('reply-1');
    expect(decisionCall.decision.outboundGhlMessageId).toBe('ghl-out-1');

    const doneCall = mockMarkProviderOrchestrationDone.mock.calls[0];
    expect(doneCall[1]).toBe('t1');
    expect(doneCall[2]).toBe('ghl-msg-1');

    expect(callOrder).toEqual(['decision', 'done']);
  });

  // ── Test 2: Failed send → FAILED_SEND, no provider done ───────────
  it('records FAILED_SEND and does NOT mark provider done on failed send', async () => {
    mockSendReply.mockResolvedValue({
      conversationId: 'conv1', tenantId: 't1',
      totalBubbles: 1, succeeded: 0, failed: 1,
      bubbleResults: [{ index: 0, text: 'Hello', success: false, error: 'GHL error' }],
      quotaDebited: 0,
    });

    await processor.process(makeJob());

    // FAILED_SEND uses recordInterimDecision (retryable, not terminal)
    const decisionCall = mockRecordInterimDecision.mock.calls[0][0];
    expect(decisionCall.decision.status).toBe('FAILED_SEND');
    expect(decisionCall.decision.reason).toContain('failed=1');

    expect(mockMarkProviderOrchestrationDone).not.toHaveBeenCalled();
  });

  // ── Test 3: Decision write failure → no provider done marker ────────
  it('does NOT mark provider done when decision write fails', async () => {
    mockRecordTerminalDecision.mockResolvedValue(false);

    await processor.process(makeJob());

    expect(mockMarkProviderOrchestrationDone).not.toHaveBeenCalled();
  });

  // ── Test 4: No providerGhlMsgId → still ok, no done marker ──────────
  it('skips provider done marker when providerGhlMsgId is missing', async () => {
    const job = makeJob();
    (job.data as any).providerGhlMessageId = undefined; // override default

    await processor.process(job);

    expect(mockRecordTerminalDecision).toHaveBeenCalledTimes(1);
    expect(mockRecordTerminalDecision.mock.calls[0][0].decision.status).toBe('PROCEED');
    expect(mockMarkProviderOrchestrationDone).not.toHaveBeenCalled();
  });

  // ── Test 5: No inboundMessageId → sends, no decision ─────────────────
  it('sends successfully without inboundMessageId, no decision recorded', async () => {
    const job = makeJob();
    (job.data as any).inboundMessageId = undefined; // override default

    await processor.process(job);

    expect(mockSendReply).toHaveBeenCalled();
    expect(mockRecordTerminalDecision).not.toHaveBeenCalled();
    expect(mockMarkProviderOrchestrationDone).toHaveBeenCalledTimes(1);
  });

  // ── Test 6: Provider done marker arguments are correct ──────────────
  it('passes correct tenantId and providerGhlMessageId to markProviderOrchestrationDone', async () => {
    await processor.process(makeJob({
      providerGhlMessageId: 'specific-ghl-id-123',
      tenantId: 'tenant-abc',
    }));

    expect(mockMarkProviderOrchestrationDone).toHaveBeenCalledTimes(1);
    const doneCall = mockMarkProviderOrchestrationDone.mock.calls[0];
    expect(doneCall[0]).toBeDefined(); // appCache
    expect(doneCall[1]).toBe('tenant-abc');
    expect(doneCall[2]).toBe('specific-ghl-id-123');
  });
});
