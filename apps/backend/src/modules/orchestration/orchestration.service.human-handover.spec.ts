import { jest as jestGlobal } from '@jest/globals';
import { ConversationOrchestrationService } from './orchestration.service';
import type { OrchestrationInput } from './dto';

// After the refactor, HUMAN_HANDOVER no longer short-circuits — it passes through AI generation
// so tenant Escalation Behaviour + Persona control the conversational reply.
// Backend actions (escalation, etc.) still execute; wording is AI-driven.

describe('ConversationOrchestrationService — HUMAN_HANDOVER AI generation', () => {
  const humanEscalationRuntime = {
    onHumanHandoverIntent: jestGlobal.fn(async () => ({ escalated: true, alreadyInHandover: false })),
  };
  const humanEscalationSettings = {
    getSettings: jestGlobal.fn(async () => ({ enabled: true })),
  };
  const followUpEngine = {
    cancelPendingJobsForHumanEscalation: jestGlobal.fn(async () => {}),
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
      promptConfig: {
        id: 'pc1',
        systemPrompt: 'test prompt',
        temperature: 0.7,
        maxTokens: null,
        isActive: true,
      },
    };
  }

  it('executes backend handover action and routes through AI for tenant-controlled reply', async () => {
    const guards = {
      runGuards: jestGlobal.fn(async () => ({ final: 'PROCEED' as const, guards: [] })),
    };
    const memoryLoader = {
      loadMemory: jestGlobal.fn(async () => ({ entries: [] })),
    };
    const aiRouter = {
      route: jestGlobal.fn(async () => ({
        recommendedModel: 'gpt-4o-mini',
        responseMode: 'fast',
        draftReply: null,
        handoverRecommended: false,
        bookingIntentDetected: false,
        tagsSuggested: [],
        confidence: 0.8,
        reasoning: 'handover_ai_routed',
      })),
    };
    const kbService = { retrieve: jestGlobal.fn(async () => ({ results: [] })) };
    const replyPlanner = {
      planReply: jestGlobal.fn(async () => ({
        planStatus: 'PLANNED',
        responseMode: 'fast',
        handoverRecommended: true,
        confidence: 0.9,
        rationale: 'ai_handover_generated',
        bubbles: [{ index: 0, text: 'I will connect you with our team.' }],
        suggestedActions: [{ type: 'ESCALATE', params: {}, reason: 'handover' }],
        draftProvenance: 'live_generation',
      })),
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
        latestIntent: 'HUMAN_HANDOVER' as const,
        resolvedSelection: null,
        kbChunks: [],
        policyForcedReply: null,
        policyReplyKind: 'none' as const,
        nextPolicyState: {
          v: 1 as const,
          activeTopic: 'handover' as const,
          awaiting: null,
          options: undefined,
          optionsUpdatedAt: null,
          optionsSource: null,
          optionsDerivedFromChunkIds: null,
          expiresAt: null,
          updatedAt: new Date().toISOString(),
        },
        conversationStateSummary: 'handover_ai_generated',
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

    jestGlobal.spyOn(ConversationOrchestrationService.prototype as never, 'persistOrchestrationLog').mockResolvedValue('log-1');
    jestGlobal
      .spyOn(ConversationOrchestrationService.prototype as never, 'persistConversationPolicyMetadata')
      .mockResolvedValue(undefined);

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
      humanEscalationSettings as never,
      followUpEngine as never,
    );

    const res = await svc.orchestrate(makeInput('Please connect me to a human'));

    // Backend escalation still executed
    expect(humanEscalationRuntime.onHumanHandoverIntent).toHaveBeenCalled();
    // AI generation is now used for the conversational reply
    expect(aiRouter.route).toHaveBeenCalled();
    expect(replyPlanner.planReply).toHaveBeenCalled();
    // Success
    expect(res.success).toBe(true);
    expect(res.replyPlan?.bubbles?.length ?? 0).toBeGreaterThan(0);

    jestGlobal.restoreAllMocks();
  });

  it('routes through AI even when escalation is unavailable — tenant prompt decides response', async () => {
    humanEscalationRuntime.onHumanHandoverIntent.mockResolvedValueOnce({
      escalated: false,
      alreadyInHandover: false,
    });

    const guards = {
      runGuards: jestGlobal.fn(async () => ({ final: 'PROCEED' as const, guards: [] })),
    };
    const memoryLoader = { loadMemory: jestGlobal.fn(async () => ({ entries: [] })) };
    const aiRouter = {
      route: jestGlobal.fn(async () => ({
        recommendedModel: 'gpt-4o-mini',
        responseMode: 'fast',
        draftReply: null,
        handoverRecommended: false,
        bookingIntentDetected: false,
        tagsSuggested: [],
        confidence: 0.8,
        reasoning: 'handover_unavailable_ai_routed',
      })),
    };
    const kbService = { retrieve: jestGlobal.fn(async () => ({ results: [] })) };
    const replyPlanner = {
      planReply: jestGlobal.fn(async () => ({
        planStatus: 'PLANNED',
        responseMode: 'fast',
        handoverRecommended: false,
        confidence: 0.9,
        rationale: 'ai_handover_generated',
        bubbles: [{ index: 0, text: 'I am unable to connect you right now, but I can help.' }],
        suggestedActions: [],
        draftProvenance: 'live_generation',
      })),
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
        latestIntent: 'HUMAN_HANDOVER' as const,
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
        conversationStateSummary: 'handover_unavailable_ai_generated',
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

    jestGlobal.spyOn(ConversationOrchestrationService.prototype as never, 'persistOrchestrationLog').mockResolvedValue('log-1');
    jestGlobal
      .spyOn(ConversationOrchestrationService.prototype as never, 'persistConversationPolicyMetadata')
      .mockResolvedValue(undefined);

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
      humanEscalationSettings as never,
      followUpEngine as never,
    );

    const res = await svc.orchestrate(makeInput('Please connect me to a human'));

    // AI generation is used regardless of escalation availability
    expect(aiRouter.route).toHaveBeenCalled();
    expect(replyPlanner.planReply).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.replyPlan?.bubbles?.length ?? 0).toBeGreaterThan(0);

    jestGlobal.restoreAllMocks();
  });
});
