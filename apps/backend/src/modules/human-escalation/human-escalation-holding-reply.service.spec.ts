import { jest as jestGlobal } from '@jest/globals';

const mockSupabaseFrom = jestGlobal.fn();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: mockSupabaseFrom,
  }),
}));

import { HumanEscalationHoldingReplyService } from './human-escalation-holding-reply.service';

describe('HumanEscalationHoldingReplyService', () => {
  const sendBubbleAdd = jestGlobal.fn(async () => ({}));
  const runtime = {
    sendInternalUpdateDuringActiveHandover: jestGlobal.fn(async () => 'sent' as const),
  };
  const handoverReply = {
    classifyAndCompose: jestGlobal.fn(async () => ({
      selectedType: 'default' as const,
      replyText: 'Your request has already been sent to the team. They’ll attend to you as soon as they’re available.',
      confidence: 0.9,
      aiReason: 'test',
      usedFallback: false,
    })),
  };

  const memoryLoader = {
    loadMemory: jestGlobal.fn(async () => ({
      conversationId: 'c1',
      entries: [],
      turnCount: 0,
      sessionStartedAt: null,
    })),
  };

  let metadata: Record<string, unknown> = {};

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    metadata = {};
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { metadata },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      return {};
    });
  });

  it('default message gets default holding reply', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'ok',
      botMode: 'autopilot',
    });
    expect(sendBubbleAdd).toHaveBeenCalledWith(
      'send-bubble',
      expect.objectContaining({
        conversationId: 'c1',
        tenantId: 't1',
        replyPlanJson: expect.stringContaining('sent to the team'),
      }),
    );
  });

  it('"how long" gets waiting-time reply', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'waiting_time',
      replyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
      confidence: 0.9,
      aiReason: 'waiting',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'how long will it take?',
    });
    expect(sendBubbleAdd).toHaveBeenCalledWith(
      'send-bubble',
      expect.objectContaining({
        replyPlanJson: expect.stringContaining('sorry for the wait'),
      }),
    );
  });

  it('"hello?" gets waiting-time reply', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'waiting_time',
      replyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
      confidence: 0.9,
      aiReason: 'waiting',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'hello?',
    });
    expect(sendBubbleAdd).toHaveBeenCalledWith(
      'send-bubble',
      expect.objectContaining({
        replyPlanJson: expect.stringContaining('sorry for the wait'),
      }),
    );
  });

  it('extra details get extra-context reply', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'extra_context',
      replyText:
        'Thank you for sharing that. I’ll pass this to the team so they have the full context when they take over.',
      confidence: 0.9,
      aiReason: 'context',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'More details: my issue started yesterday and I have photos if needed.',
    });
    expect(sendBubbleAdd).toHaveBeenCalledWith(
      'send-bubble',
      expect.objectContaining({
        replyPlanJson: expect.stringContaining('pass this to the team'),
      }),
    );
  });

  it('identical holding reply is suppressed by cooldown', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'default',
      humanEscalationLastHoldingReplyText:
        'Your request has already been sent to the team. They’ll attend to you as soon as they’re available.',
    };
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'ok',
    });
    expect(sendBubbleAdd).not.toHaveBeenCalled();
  });

  it('default → waiting_time inside cooldown is allowed', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'default',
      humanEscalationLastHoldingReplyText:
        'Your request has already been sent to the team. They’ll attend to you as soon as they’re available.',
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'waiting_time',
      replyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
      confidence: 0.9,
      aiReason: 'waiting',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'how long?',
    });
    expect(sendBubbleAdd).toHaveBeenCalledWith(
      'send-bubble',
      expect.objectContaining({
        replyPlanJson: expect.stringContaining('sorry for the wait'),
      }),
    );
  });

  it('extra_context → waiting_time inside cooldown is allowed', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'extra_context',
      humanEscalationLastHoldingReplyText:
        'Thank you for sharing that. I’ll pass this to the team so they have the full context when they take over.',
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'waiting_time',
      replyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
      confidence: 0.95,
      aiReason: 'waiting',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'btw may i know how long?',
    });
    expect(sendBubbleAdd).toHaveBeenCalledWith(
      'send-bubble',
      expect.objectContaining({
        replyPlanJson: expect.stringContaining('sorry for the wait'),
      }),
    );
  });

  it('waiting_time → extra_context inside cooldown is allowed', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'waiting_time',
      humanEscalationLastHoldingReplyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'extra_context',
      replyText:
        'Thank you for sharing that. I’ll pass this to the team so they have the full context when they take over.',
      confidence: 0.9,
      aiReason: 'context',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'more details…',
    });
    expect(sendBubbleAdd).toHaveBeenCalledWith(
      'send-bubble',
      expect.objectContaining({
        replyPlanJson: expect.stringContaining('pass this to the team'),
      }),
    );
  });

  it('same waiting_time within cooldown is suppressed', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'waiting_time',
      humanEscalationLastHoldingReplyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'waiting_time',
      replyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
      confidence: 0.95,
      aiReason: 'waiting',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'when?',
    });
    expect(sendBubbleAdd).not.toHaveBeenCalled();
  });

  it('same extra_context within cooldown is suppressed', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'extra_context',
      humanEscalationLastHoldingReplyText:
        'Thank you for sharing that. I’ll pass this to the team so they have the full context when they take over.',
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'extra_context',
      replyText:
        'Thank you for sharing that. I’ll pass this to the team so they have the full context when they take over.',
      confidence: 0.9,
      aiReason: 'context',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'more details',
    });
    expect(sendBubbleAdd).not.toHaveBeenCalled();
  });

  it('frustration after non-frustration inside cooldown is allowed', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'extra_context',
      humanEscalationLastHoldingReplyText:
        'Thank you for sharing that. I’ll pass this to the team so they have the full context when they take over.',
    };
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'frustration',
      replyText:
        'I understand this is frustrating. I’ve already flagged this for the team, and they’ll attend to you as soon as they’re available.',
      confidence: 0.9,
      aiReason: 'frustration',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'this is ridiculous',
    });
    expect(sendBubbleAdd).toHaveBeenCalled();
  });

  it('near-duplicate only suppresses if same type', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'waiting_time',
      humanEscalationLastHoldingReplyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
    };

    // Different type, similar-ish text should still be allowed now.
    handoverReply.classifyAndCompose.mockResolvedValueOnce({
      selectedType: 'extra_context',
      replyText:
        'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
      confidence: 0.9,
      aiReason: 'test',
      usedFallback: false,
    });
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'extra context',
    });
    expect(sendBubbleAdd).toHaveBeenCalled();
  });

  it('does not enqueue in suggestive mode', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'hello?',
      botMode: 'suggestive',
    });
    expect(sendBubbleAdd).not.toHaveBeenCalled();
  });

  it('internal update is sent only after 10-minute window', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastInternalUpdateSentAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    };
    const svc = new HumanEscalationHoldingReplyService(
      { add: sendBubbleAdd } as never,
      runtime as never,
      handoverReply as never,
      memoryLoader as never,
    );
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'hello?',
    });
    // Suppressed because last update was 2 minutes ago.
    expect(runtime.sendInternalUpdateDuringActiveHandover).not.toHaveBeenCalled();

    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      humanEscalationLastInternalUpdateSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'still waiting',
    });
    expect(runtime.sendInternalUpdateDuringActiveHandover).toHaveBeenCalled();
  });
});
