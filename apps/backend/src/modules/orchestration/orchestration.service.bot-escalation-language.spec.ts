import { jest as jestGlobal } from '@jest/globals';
import { ConversationOrchestrationService } from './orchestration.service';
import type { OrchestrationInput } from './dto';
import type { ReplyDecision } from '../reply-planning/dto';

describe('ConversationOrchestrationService — bot reply human escalation language', () => {
  const humanEscalationRuntime = {
    onHumanHandoverIntent: jestGlobal.fn(async () => ({ escalated: true, alreadyInHandover: false })),
  };

  function makeInput(message: string): OrchestrationInput {
    return {
      tenantId: 't1',
      conversationId: 'c1',
      webhookEventId: 'w1',
      incomingMessage: {
        ghlLocationId: 'loc',
        ghlConversationId: 'gc',
        ghlContactId: 'ct',
        messageContent: message,
        messageType: 'text',
        timestamp: new Date().toISOString(),
        externalEventId: 'e',
        eventType: 'inbound_message',
        dedupeKey: 'd',
        channelRaw: null,
      },
      tenant: {
        id: 't1',
        name: 'Tenant',
        botEnabled: true,
        botMode: 'autopilot',
        handoverPaused: false,
        ghlLocationId: 'loc',
      },
      conversation: {
        id: 'c1',
        ghlConversationId: 'gc',
        contactId: 'ct',
        channel: 'WHATSAPP',
        status: 'ACTIVE',
        metadata: {},
      },
    };
  }

  function makeReplyPlan(text: string, extra: Partial<ReplyDecision> = {}): ReplyDecision {
    return {
      planStatus: 'PLANNED',
      responseMode: 'standard',
      handoverRecommended: false,
      confidence: 0.9,
      rationale: 'live_generation',
      bubbles: [{ index: 0, text }],
      suggestedActions: [],
      draftProvenance: 'live_generation',
      botHumanEscalationLanguageDetected: true,
      ...extra,
    };
  }

  it('escalates when planned bot reply promises team follow-up', async () => {
    const guards = {
      runGuards: jestGlobal.fn(async () => ({ final: 'PROCEED' as const, guards: [] })),
    };
    const memoryLoader = {
      loadMemory: jestGlobal.fn(async () => ({ entries: [] })),
    };
    const aiRouter = {
      route: jestGlobal.fn(async () => ({
        recommendedModel: 'n/a',
        responseMode: 'standard',
        draftReply: null,
        handoverRecommended: false,
        bookingIntentDetected: false,
        tagsSuggested: [],
        confidence: 0.9,
        reasoning: 'test',
      })),
    };
    const kbService = { retrieve: jestGlobal.fn(async () => ({ chunks: [], meta: null })) };
    const replyPlan = makeReplyPlan('Thanks — our team will reach out to you shortly.');
    const replyPlanner = {
      planReply: jestGlobal.fn(async () => replyPlan),
      buildOptionSelectionTemplateReply: jestGlobal.fn(),
    };
    const conversationPolicy = {
      parseState: jestGlobal.fn(() => ({
        v: 1 as const,
        activeTopic: null,
        awaiting: null,
        options: undefined,
        optionsUpdatedAt: null,
        optionsSource: null,
        optionsDerivedFromChunkIds: null,
        expiresAt: null,
        updatedAt: new Date().toISOString(),
      })),
      evaluate: jestGlobal.fn(() => ({
        latestIntent: 'MENU' as const,
        resolvedSelection: null,
        kbChunks: [],
        policyForcedReply: null,
        policyReplyKind: 'none' as const,
        nextPolicyState: {
          v: 1 as const,
          activeTopic: null,
          awaiting: null,
          options: undefined,
          optionsUpdatedAt: null,
          optionsSource: null,
          optionsDerivedFromChunkIds: null,
          expiresAt: null,
          updatedAt: new Date().toISOString(),
        },
        conversationStateSummary: 'menu',
        menuSelectionActive: false,
      })),
      recordAssistantOptions: jestGlobal.fn((s: unknown) => s),
    };
    const conversationsService = {};
    const bookingFlow = {
      maybeHandleConversationBookingTurn: jestGlobal.fn(async () => ({ handled: false })),
    };
    const bookingSettings = { getBookingSettings: jestGlobal.fn(async () => ({ enabled: false })) };
    const botProfiles = {
      getActivePromptForOrchestration: jestGlobal.fn(async () => null),
      getKbDocumentAllowlistForActiveProfile: jestGlobal.fn(async () => ({ kind: 'none' as const, reason: 'test' })),
    };

    jestGlobal.spyOn(ConversationOrchestrationService.prototype as never, 'persistOrchestrationLog').mockResolvedValue('log1');
    jestGlobal
      .spyOn(ConversationOrchestrationService.prototype as never, 'persistConversationPolicyMetadata')
      .mockResolvedValue(undefined);
    jestGlobal
      .spyOn(ConversationOrchestrationService.prototype as never, 'retrieveKbContext')
      .mockResolvedValue({ chunks: [], meta: { chunksReturned: 0, chunksConsidered: 0, retrievalMode: 'hybrid', topScore: null } });
    jestGlobal
      .spyOn(ConversationOrchestrationService.prototype as never, 'resolveBookingCapabilityForGovernor')
      .mockResolvedValue('collect_details_only');

    const svc = new ConversationOrchestrationService(
      guards as never,
      memoryLoader as never,
      aiRouter as never,
      kbService as never,
      replyPlanner as never,
      conversationPolicy as never,
      conversationsService as never,
      bookingFlow as never,
      bookingSettings as never,
      botProfiles as never,
      humanEscalationRuntime as never,
      { getSettings: jestGlobal.fn(async () => ({ enabled: true })) } as never,
      { cancelPendingJobsForHumanEscalation: jestGlobal.fn(async () => {}) } as never,
    );

    const result = await svc.orchestrate(makeInput('what are your hours?'));

    expect(humanEscalationRuntime.onHumanHandoverIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        handoverReason: 'bot_reply:HUMAN_ESCALATION_PROMISE',
        latestInboundMessage: 'what are your hours?',
      }),
    );
    expect(result.replyPlan?.draftProvenance).toBe('human_escalation');
    expect(result.replyPlan?.handoverRecommended).toBe(true);
    expect(result.replyPlan?.bubbles[0]?.text).toContain('team will reach out');

    jestGlobal.restoreAllMocks();
  });

  it('escalates to human takeover when planner cannot produce a safe reply', async () => {
    const guards = {
      runGuards: jestGlobal.fn(async () => ({ final: 'PROCEED' as const, guards: [] })),
    };
    const memoryLoader = {
      loadMemory: jestGlobal.fn(async () => ({ entries: [] })),
    };
    const aiRouter = {
      route: jestGlobal.fn(async () => ({
        recommendedModel: 'n/a',
        responseMode: 'standard',
        draftReply: null,
        handoverRecommended: false,
        bookingIntentDetected: false,
        tagsSuggested: [],
        confidence: 0.9,
        reasoning: 'test',
      })),
    };
    const kbService = { retrieve: jestGlobal.fn(async () => ({ chunks: [], meta: null })) };
    const replyPlanner = {
      planReply: jestGlobal.fn(async () => ({
        planStatus: 'SKIP_NO_REPLY',
        responseMode: 'standard',
        handoverRecommended: false,
        confidence: 0.8,
        rationale: 'draft_blocked:generation_failed',
        bubbles: [],
        suggestedActions: [],
        draftProvenance: 'placeholder_fallback',
        draftFallbackReason: 'generation_failed',
      })),
      buildOptionSelectionTemplateReply: jestGlobal.fn(),
    };
    const emptyState = {
      v: 1 as const,
      activeTopic: null,
      awaiting: null,
      options: undefined,
      optionsUpdatedAt: null,
      optionsSource: null,
      optionsDerivedFromChunkIds: null,
      expiresAt: null,
      updatedAt: new Date().toISOString(),
    };
    const conversationPolicy = {
      parseState: jestGlobal.fn(() => emptyState),
      evaluate: jestGlobal.fn(() => ({
        latestIntent: 'UNKNOWN' as const,
        resolvedSelection: null,
        kbChunks: [],
        policyForcedReply: null,
        policyReplyKind: 'none' as const,
        nextPolicyState: emptyState,
        conversationStateSummary: 'passthrough',
        menuSelectionActive: false,
      })),
      recordAssistantOptions: jestGlobal.fn((s: unknown) => s),
    };
    const conversationsService = {
      pauseForHandover: jestGlobal.fn(async () => undefined),
    };
    const bookingFlow = {
      maybeHandleConversationBookingTurn: jestGlobal.fn(async () => ({ handled: false })),
    };
    const bookingSettings = { getBookingSettings: jestGlobal.fn(async () => ({ enabled: false })) };
    const botProfiles = {
      getActivePromptForOrchestration: jestGlobal.fn(async () => null),
      getKbDocumentAllowlistForActiveProfile: jestGlobal.fn(async () => ({ kind: 'none' as const, reason: 'test' })),
    };

    jestGlobal.spyOn(ConversationOrchestrationService.prototype as never, 'persistOrchestrationLog').mockResolvedValue('log1');
    jestGlobal
      .spyOn(ConversationOrchestrationService.prototype as never, 'persistConversationPolicyMetadata')
      .mockResolvedValue(undefined);
    jestGlobal
      .spyOn(ConversationOrchestrationService.prototype as never, 'retrieveKbContext')
      .mockResolvedValue({ chunks: [], meta: { chunksReturned: 0, chunksConsidered: 0, retrievalMode: 'hybrid', topScore: null } });
    jestGlobal
      .spyOn(ConversationOrchestrationService.prototype as never, 'resolveBookingCapabilityForGovernor')
      .mockResolvedValue('collect_details_only');

    const svc = new ConversationOrchestrationService(
      guards as never,
      memoryLoader as never,
      aiRouter as never,
      kbService as never,
      replyPlanner as never,
      conversationPolicy as never,
      conversationsService as never,
      bookingFlow as never,
      bookingSettings as never,
      botProfiles as never,
      humanEscalationRuntime as never,
      { getSettings: jestGlobal.fn(async () => ({ enabled: true })) } as never,
      { cancelPendingJobsForHumanEscalation: jestGlobal.fn(async () => {}) } as never,
    );

    const result = await svc.orchestrate(makeInput('Can you help me?'));

    expect(humanEscalationRuntime.onHumanHandoverIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        handoverReason: 'no_safe_ai_reply',
        latestInboundMessage: 'Can you help me?',
      }),
    );
    expect(result.replyPlan?.planStatus).toBe('HANDOVER');
    expect(result.replyPlan?.draftProvenance).toBe('human_escalation');
    expect(result.replyPlan?.handoverRecommended).toBe(true);
    expect(result.replyPlan?.bubbles).toEqual([]);

    jestGlobal.restoreAllMocks();
  });
});
