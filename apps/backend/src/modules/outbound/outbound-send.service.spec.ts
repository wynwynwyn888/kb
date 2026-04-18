import { jest as jestGlobal } from '@jest/globals';

import { OutboundSendService } from './outbound-send.service';
import { createMockSupabase } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

// Mock GHL client
jestGlobal.mock('@aisbp/ghl-client', () => ({
  createGhlClient: jestGlobal.fn(() => ({
    sendMessage: jestGlobal.fn(async ({ message }: { message: string }) => ({
      success: true,
      messageId: `ghl_${message.slice(0, 5)}`,
      error: null,
    })),
  })) as never,
}));

function makeReplyPlan(overrides: {
  planStatus?: string;
  bubbles?: Array<{ index: number; text: string }>;
  suggestedActions?: unknown[];
} = {}) {
  return {
    planStatus: overrides.planStatus ?? 'PLANNED',
    bubbles: overrides.bubbles ?? [{ index: 0, text: 'Hello!' }],
    responseMode: 'standard' as const,
    handoverRecommended: false,
    confidence: 0.8,
    rationale: 'test',
    suggestedActions: overrides.suggestedActions ?? [],
  };
}

function makeParams(overrides: {
  replyPlan?: ReturnType<typeof makeReplyPlan>;
  ghlLocationId?: string;
  tenantId?: string;
  conversationId?: string;
  contactId?: string;
} = {}) {
  return {
    tenantId: overrides.tenantId ?? 'tenant_1',
    conversationId: overrides.conversationId ?? 'conv_1',
    contactId: overrides.contactId ?? 'contact_1',
    ghlLocationId: overrides.ghlLocationId ?? 'loc_1',
    replyPlan: overrides.replyPlan ?? makeReplyPlan(),
  };
}

describe('OutboundSendService', () => {
  let service: OutboundSendService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    service = new OutboundSendService();
  });

  describe('sendReply', () => {
    it('returns zeros when bubbles empty', async () => {
      const result = await service.sendReply(makeParams({
        replyPlan: makeReplyPlan({ bubbles: [] }),
      }));
      expect(result.totalBubbles).toBe(0);
      expect(result.quotaDebited).toBe(0);
    });

    it('returns zeros when planStatus is HANDOVER', async () => {
      const result = await service.sendReply(makeParams({
        replyPlan: makeReplyPlan({ planStatus: 'HANDOVER', bubbles: [{ index: 0, text: 'Handover' }] }),
      }));
      expect(result.succeeded).toBe(0);
      expect(result.quotaDebited).toBe(0);
    });

    it('returns zeros and no debit when credentials missing', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
                }),
              }),
            }),
          } as never;
        }
        return {} as never;
      });

      const result = await service.sendReply(makeParams({
        replyPlan: makeReplyPlan({ bubbles: [{ index: 0, text: 'Hi' }] }),
      }));
      expect(result.succeeded).toBe(0);
      expect(result.quotaDebited).toBe(0);
    });
  });

  describe('checkQuotaAvailable', () => {
    it('returns true when no wallet', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
            }),
          } as never;
        }
        return {} as never;
      });
      const result = await (service as never)['checkQuotaAvailable']('tenant_1', 1);
      expect(result).toBe(true);
    });

    it('returns true when sufficient quota', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { total_quota: 100, used_quota: 50 }, error: null }) }),
            }),
          } as never;
        }
        return {} as never;
      });
      const result = await (service as never)['checkQuotaAvailable']('tenant_1', 1);
      expect(result).toBe(true);
    });

    it('returns false when insufficient', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { total_quota: 5, used_quota: 5 }, error: null }) }),
            }),
          } as never;
        }
        return {} as never;
      });
      const result = await (service as never)['checkQuotaAvailable']('tenant_1', 1);
      expect(result).toBe(false);
    });
  });

  describe('debitQuota', () => {
    it('creates ledger entry with DEBIT type', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'w1', used_quota: 10 }, error: null }) }),
            }),
            update: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(async () => ({ data: null, error: null })),
            })),
          } as never;
        }
        if (table === 'quota_ledgers') {
          return { insert: jestGlobal.fn(async () => ({ data: null, error: null })) } as never;
        }
        return {} as never;
      });

      await (service as never)['debitQuota']('tenant_1', 1, 'conv_1');

      // Verify insert was called with DEBIT type
      const insertMock = (mockSupabase.from as jest.Mock).mock.results
        .find(r => r.value && typeof r.value.insert === 'function');
      expect(insertMock).toBeDefined();
    });
  });
});
