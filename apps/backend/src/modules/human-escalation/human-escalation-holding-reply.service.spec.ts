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
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never, runtime as never);
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
        replyPlanJson: expect.stringContaining('A team member has been notified'),
      }),
    );
  });

  it('"how long" gets waiting-time reply', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never, runtime as never);
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
        replyPlanJson: expect.stringContaining("I'm sorry for the wait"),
      }),
    );
  });

  it('"hello?" gets waiting-time reply', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never, runtime as never);
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
        replyPlanJson: expect.stringContaining("I'm sorry for the wait"),
      }),
    );
  });

  it('extra details get extra-context reply', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never, runtime as never);
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
        replyPlanJson: expect.stringContaining("I'll leave this here for the team to review"),
      }),
    );
  });

  it('identical holding reply is suppressed by cooldown', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'default',
    };
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never, runtime as never);
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      latestInboundText: 'ok',
    });
    expect(sendBubbleAdd).not.toHaveBeenCalled();
  });

  it('waiting-time reply can override generic cooldown once', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      humanEscalationLastHoldingReplySentAt: recent,
      humanEscalationLastHoldingReplyType: 'default',
    };
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never, runtime as never);
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
        replyPlanJson: expect.stringContaining("I'm sorry for the wait"),
      }),
    );
  });

  it('does not enqueue in suggestive mode', async () => {
    metadata = {
      humanEscalationInternalAlertSentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never, runtime as never);
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
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never, runtime as never);
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
