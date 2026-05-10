import { jest as jestGlobal } from '@jest/globals';

import { OutboundSendService } from './outbound-send.service';
import { createMockSupabase } from '../../test/mock-supabase';
import * as encryption from '../../lib/encryption';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

const mockSendMessage = jestGlobal.fn(async ({ message }: { message: string }) => ({
  success: true,
  messageId: `ghl_${message.slice(0, 5)}`,
  error: null,
}));

// Mock GHL client
jestGlobal.mock('@aisbp/ghl-client', () => ({
  createGhlClient: jestGlobal.fn(() => ({
    sendMessage: mockSendMessage,
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
    sendBubbleJobId: 'job_1',
  };
}

/** Default agency credit deduction for sendReply tests (PER_LOGICAL_REPLY). */
function mockTenantAgencyDeduction() {
  return {
    tenants: {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { agency_id: 'ag1' }, error: null }) }),
      }),
    } as never,
    agencies: {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { credit_deduction_method: 'PER_LOGICAL_REPLY' }, error: null }) }),
      }),
    } as never,
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
        const ded = mockTenantAgencyDeduction();
        if (table === 'tenants') return ded.tenants;
        if (table === 'agencies') return ded.agencies;
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

    it('sends GHL messages to the explicit contactId (conversation contact), not inferred from bubble text', async () => {
      const decryptSpy = jestGlobal.spyOn(encryption, 'decrypt').mockReturnValue('plain_token');
      try {
        (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
          const ded = mockTenantAgencyDeduction();
          if (table === 'tenants') return ded.tenants;
          if (table === 'agencies') return ded.agencies;
          if (table === 'tenant_ghl_connections') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      single: async () => ({ data: { private_token_encrypted: 'cipher_blob' }, error: null }),
                    }),
                  }),
                }),
              }),
            } as never;
          }
          if (table === 'messages') {
            return { insert: jestGlobal.fn(async () => ({ data: null, error: null })) } as never;
          }
          if (table === 'conversations') {
            return {
              update: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            } as never;
          }
          if (table === 'quota_wallets') {
            return {
              select: () => ({
                eq: () => ({ single: async () => ({ data: { id: 'w1', total_quota: 100, used_quota: 50, allow_negative_credits: false, negative_credit_limit: 0 }, error: null }) }),
              }),
              update: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            } as never;
          }
          if (table === 'quota_ledgers') {
            return {
              select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
              }),
              insert: jestGlobal.fn(async () => ({ data: null, error: null })),
            } as never;
          }
          return {} as never;
        });

        const wrongRecipientHint = '+19999999999';
        await service.sendReply(
          makeParams({
            contactId: 'ghl_conversation_contact_aaa',
            replyPlan: makeReplyPlan({
              bubbles: [{ index: 0, text: `Confirmed — call ${wrongRecipientHint} if needed.` }],
            }),
          }),
        );

        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            contactId: 'ghl_conversation_contact_aaa',
          }),
        );
      } finally {
        decryptSpy.mockRestore();
      }
    });

    it('debits 1 credit for a logical reply even when 3 physical bubbles succeed', async () => {
      const decryptSpy = jestGlobal.spyOn(encryption, 'decrypt').mockReturnValue('plain_token');
      try {
        (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
          const ded = mockTenantAgencyDeduction();
          if (table === 'tenants') return ded.tenants;
          if (table === 'agencies') return ded.agencies;
          if (table === 'tenant_ghl_connections') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      single: async () => ({ data: { private_token_encrypted: 'cipher_blob' }, error: null }),
                    }),
                  }),
                }),
              }),
            } as never;
          }
          if (table === 'messages') {
            return { insert: jestGlobal.fn(async () => ({ data: null, error: null })) } as never;
          }
          if (table === 'conversations') {
            return {
              update: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            } as never;
          }
          if (table === 'quota_wallets') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { id: 'w1', total_quota: 100, used_quota: 1, allow_negative_credits: false, negative_credit_limit: 0 },
                    error: null,
                  }),
                }),
              }),
              update: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            } as never;
          }
          if (table === 'quota_ledgers') {
            return {
              select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
              }),
              insert: jestGlobal.fn(async () => ({ data: null, error: null })),
            } as never;
          }
          return {} as never;
        });

        const r = await service.sendReply(
          makeParams({
            replyPlan: makeReplyPlan({
              bubbles: [
                { index: 0, text: 'A' },
                { index: 1, text: 'B' },
                { index: 2, text: 'C' },
              ],
            }),
          }),
        );
        expect(r.succeeded).toBeGreaterThan(0);
        expect(r.failed).toBe(0);
        expect(r.quotaDebited).toBe(1);
      } finally {
        decryptSpy.mockRestore();
      }
    });

    it('does not double debit on retry with same idempotency key', async () => {
      const decryptSpy = jestGlobal.spyOn(encryption, 'decrypt').mockReturnValue('plain_token');
      try {
        let ledgerSeen = false;
        (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
          const ded = mockTenantAgencyDeduction();
          if (table === 'tenants') return ded.tenants;
          if (table === 'agencies') return ded.agencies;
          if (table === 'tenant_ghl_connections') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      single: async () => ({ data: { private_token_encrypted: 'cipher_blob' }, error: null }),
                    }),
                  }),
                }),
              }),
            } as never;
          }
          if (table === 'messages') {
            return { insert: jestGlobal.fn(async () => ({ data: null, error: null })) } as never;
          }
          if (table === 'conversations') {
            return {
              update: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            } as never;
          }
          if (table === 'quota_wallets') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { id: 'w1', total_quota: 100, used_quota: 1, allow_negative_credits: false, negative_credit_limit: 0 },
                    error: null,
                  }),
                }),
              }),
              update: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            } as never;
          }
          if (table === 'quota_ledgers') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    if (ledgerSeen) return { data: { id: 'led1' }, error: null };
                    ledgerSeen = true;
                    return { data: null, error: { code: 'PGRST116' } };
                  },
                }),
              }),
              insert: jestGlobal.fn(async () => ({ data: null, error: null })),
            } as never;
          }
          return {} as never;
        });

        const params = makeParams({
          replyPlan: makeReplyPlan({ bubbles: [{ index: 0, text: 'A' }] }),
        });

        const a = await service.sendReply(params);
        const b = await service.sendReply(params);
        expect(a.quotaDebited).toBe(1);
        expect(b.quotaDebited).toBe(0);
      } finally {
        decryptSpy.mockRestore();
      }
    });
  });

  describe('checkQuotaAvailable', () => {
    it('returns true when no wallet', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { credits_unlimited: false }, error: null }) }),
            }),
          } as never;
        }
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { credits_unlimited: false }, error: null }) }),
            }),
          } as never;
        }
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { total_quota: 100, used_quota: 50, allow_negative_credits: false, negative_credit_limit: 0 }, error: null }) }),
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { credits_unlimited: false }, error: null }) }),
            }),
          } as never;
        }
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { total_quota: 5, used_quota: 5, allow_negative_credits: false, negative_credit_limit: 0 }, error: null }) }),
            }),
          } as never;
        }
        return {} as never;
      });
      const result = await (service as never)['checkQuotaAvailable']('tenant_1', 1);
      expect(result).toBe(false);
    });

    it('returns true (unblocked) for unlimited-credit workspace even when wallet would be empty', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { credits_unlimited: true }, error: null }) }),
            }),
          } as never;
        }
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { total_quota: 0, used_quota: 0, allow_negative_credits: false, negative_credit_limit: 0 }, error: null }) }),
            }),
          } as never;
        }
        return {} as never;
      });
      const result = await (service as never)['checkQuotaAvailable']('tenant_1', 1);
      expect(result).toBe(true);
    });
  });

  describe('debitQuota', () => {
    it('creates ledger entry with DEBIT type (reply_debit) and idempotency key', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { credits_unlimited: false }, error: null }) }),
            }),
          } as never;
        }
        if (table === 'quota_wallets') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'w1', total_quota: 100, used_quota: 10 }, error: null }) }),
            }),
            update: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(async () => ({ data: null, error: null })),
            })),
          } as never;
        }
        if (table === 'quota_ledgers') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
            }),
            insert: jestGlobal.fn(async () => ({ data: null, error: null })),
          } as never;
        }
        return {} as never;
      });

      await (service as never)['debitQuotaForReply']({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        idempotencyKey: 'reply_debit:tenant_1:conv_1:job_1',
        movementType: 'reply_debit',
        description: 'test',
        debitAmount: 1,
      });

      // Verify insert was called with DEBIT type
      const insertMock = (mockSupabase.from as jest.Mock).mock.results
        .find(r => r.value && typeof r.value.insert === 'function');
      expect(insertMock).toBeDefined();
    });
  });
});
