import { jest as jestGlobal } from '@jest/globals';
import { ConversationOrchestrationService } from './orchestration.service';
import type { OrchestrationInput } from './dto';

describe('ConversationOrchestrationService — HUMAN_HANDOVER short circuit', () => {
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
    };
  }

  it('returns PLANNED handover acknowledgement (no full AI) and invokes human escalation runtime', async () => {
    const guards = {
      runGuards: jestGlobal.fn(async () => ({ final: 'PROCEED' as const, guards: [] })),
    };
    const memoryLoader = {
      loadMemory: jestGlobal.fn(async () => ({ entries: [] })),
    };
    const aiRouter = { route: jestGlobal.fn() };
    const kbService = { retrieve: jestGlobal.fn() };
    const replyPlanner = { planReply: jestGlobal.fn() };
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
        conversationStateSummary: 'cleared_for_human_handover',
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

    expect(humanEscalationRuntime.onHumanHandoverIntent).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.replyPlan?.planStatus).toBe('PLANNED');
    expect(res.replyPlan?.bubbles ?? []).toHaveLength(1);
    expect(res.replyPlan?.bubbles?.[0]?.text).toContain('team member');
    expect(aiRouter.route).not.toHaveBeenCalled();
    expect(replyPlanner.planReply).not.toHaveBeenCalled();

    jestGlobal.restoreAllMocks();
  });

  it('still acks human handover when escalation settings are disabled', async () => {
    humanEscalationRuntime.onHumanHandoverIntent.mockResolvedValueOnce({
      escalated: false,
      alreadyInHandover: false,
    });

    const guards = {
      runGuards: jestGlobal.fn(async () => ({ final: 'PROCEED' as const, guards: [] })),
    };
    const memoryLoader = { loadMemory: jestGlobal.fn(async () => ({ entries: [] })) };
    const aiRouter = { route: jestGlobal.fn() };
    const kbService = { retrieve: jestGlobal.fn() };
    const replyPlanner = { planReply: jestGlobal.fn() };
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
        conversationStateSummary: 'human_handover',
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

    expect(res.replyPlan?.bubbles?.[0]?.text).toContain('team member');
    expect(res.replyPlan?.handoverRecommended).toBe(false);
    expect(aiRouter.route).not.toHaveBeenCalled();
    expect(bookingFlow.maybeHandleConversationBookingTurn).not.toHaveBeenCalled();

    jestGlobal.restoreAllMocks();
  });
});
