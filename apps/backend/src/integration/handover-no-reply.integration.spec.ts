import { jest as jestGlobal } from '@jest/globals';

import { OutboundSendService } from '../modules/outbound/outbound-send.service';
import { SendBubbleProcessor } from '../queues/processors/send-bubble.processor';
import { ConversationsService } from '../modules/conversations/conversations.service';
import { ActionGatingService } from '../modules/action-gating/action-gating.service';
import { ActionIntentExecutorService } from '../modules/action-execution/action-intent-executor.service';
import { OutboundSafetyGovernorService } from '../modules/outbound/outbound-safety-governor.service';
import { createMockSupabase } from '../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

jestGlobal.mock('@aisbp/ghl-client', () => ({
  createGhlClient: jestGlobal.fn(() => ({
    sendMessage: jestGlobal.fn(async () => ({ success: true, messageId: 'ghl_1' })),
  })) as never,
}));

jestGlobal.mock('@nestjs/bullmq', () => {
  // Create a proper mock WorkerHost class
  class MockWorkerHost {
    run = jestGlobal.fn();
  }
  return {
    InjectQueue: () => jestGlobal.fn(),
    Queue: jestGlobal.fn(() => ({ add: jestGlobal.fn() })) as never,
    WorkerHost: MockWorkerHost,
    OnWorkerEvent: () => jestGlobal.fn(),
    Processor: () => jestGlobal.fn(),
  };
});

jestGlobal.mock('bullmq', () => ({
  Job: class {},
}));

describe('Handover Active → No Outbound Reply', () => {
  let outboundService: OutboundSendService;
  let conversationsService: ConversationsService;
  let actionGatingService: ActionGatingService;
  let actionExecutor: ActionIntentExecutorService;
  let sendBubbleProcessor: SendBubbleProcessor;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    outboundService = new OutboundSendService();
    conversationsService = new ConversationsService();
    actionGatingService = new ActionGatingService();
    actionExecutor = new ActionIntentExecutorService();
    const outboundGovernor = new OutboundSafetyGovernorService();
    sendBubbleProcessor = new SendBubbleProcessor(
      outboundService,
      conversationsService,
      actionGatingService,
      actionExecutor,
      outboundGovernor,
    );
  });

  describe('OutboundSendService', () => {
    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockSupabase.from as jestGlobal.Mock).mockImplementation((table: string): any => {
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({ single: async () => ({ data: { private_token_encrypted: 'tok' }, error: null }) }),
                }),
              }),
            }),
          };
        }
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'w1', total_quota: 100, used_quota: 50 }, error: null }) }),
            }),
          };
        }
        if (table === 'messages') {
          return { insert: jestGlobal.fn(async () => ({ data: null, error: null })) };
        }
        if (table === 'conversations') {
          return { update: jestGlobal.fn(async () => ({ data: null, error: null })) };
        }
        if (table === 'quota_ledgers') {
          return { insert: jestGlobal.fn(async () => ({ data: null, error: null })) };
        }
        return {};
      });
    });

    it('skips outbound send when planStatus is HANDOVER', async () => {
      const replyPlan = {
        planStatus: 'HANDOVER' as const,
        bubbles: [{ index: 0, text: 'Handing over' }],
        responseMode: 'handover' as const,
        handoverRecommended: true,
        confidence: 0.9,
        rationale: 'Human handoff needed',
        suggestedActions: [],
      };

      const result = await outboundService.sendReply({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        contactId: 'contact_1',
        ghlLocationId: 'loc_1',
        replyPlan,
      });

      expect(result.totalBubbles).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.quotaDebited).toBe(0);
    });

    it('skips outbound when bubbles array is empty', async () => {
      const replyPlan = {
        planStatus: 'PLANNED' as const,
        bubbles: [] as never[],
        responseMode: 'standard' as const,
        handoverRecommended: false,
        confidence: 0.8,
        rationale: 'test',
        suggestedActions: [],
      };

      const result = await outboundService.sendReply({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        contactId: 'contact_1',
        ghlLocationId: 'loc_1',
        replyPlan,
      });

      expect(result.totalBubbles).toBe(0);
      expect(result.quotaDebited).toBe(0);
    });
  });

  describe('SendBubbleProcessor handover path', () => {
    it('sets handover state when reply plan is HANDOVER', async () => {
      jestGlobal.spyOn(outboundService, 'sendReply').mockResolvedValue({
        conversationId: 'conv_1',
        tenantId: 'tenant_1',
        totalBubbles: 1,
        succeeded: 0,
        failed: 0,
        quotaDebited: 0,
        bubbleResults: [],
      });

      jestGlobal.spyOn(conversationsService, 'getActiveHandover').mockResolvedValue(null);
      jestGlobal.spyOn(conversationsService, 'pauseForHandover').mockResolvedValue('he_1');
      jestGlobal.spyOn(actionGatingService, 'gateActions').mockResolvedValue([]);

      const job = {
        data: {
          conversationId: 'conv_1',
          tenantId: 'tenant_1',
          contactId: 'contact_1',
          ghlLocationId: 'loc_1',
          replyPlanJson: JSON.stringify({
            planStatus: 'HANDOVER',
            bubbles: [{ index: 0, text: 'Connecting you...' }],
            handoverRecommended: true,
            suggestedActions: [],
            rationale: 'test',
          }),
        },
        id: 'job_1',
      } as never;

      await sendBubbleProcessor.process(job);

      expect(conversationsService.pauseForHandover).toHaveBeenCalledWith(
        'conv_1',
        'REQUEST',
        'AI',
        'test',
      );
    });
  });
});
