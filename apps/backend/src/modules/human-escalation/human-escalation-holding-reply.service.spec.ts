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

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { metadata: {} },
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

  it('enqueues holding reply and logs path when not in cooldown', async () => {
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never);
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
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

  it('suppresses when last holding reply was within cooldown', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { metadata: { humanEscalationLastHoldingReplySentAt: recent } },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never);
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
    });
    expect(sendBubbleAdd).not.toHaveBeenCalled();
  });

  it('does not enqueue in suggestive mode', async () => {
    const svc = new HumanEscalationHoldingReplyService({ add: sendBubbleAdd } as never);
    await svc.tryEnqueueHoldingReply({
      tenantId: 't1',
      conversationId: 'c1',
      locationId: 'loc',
      ghlContactId: 'ct1',
      botMode: 'suggestive',
    });
    expect(sendBubbleAdd).not.toHaveBeenCalled();
  });
});
