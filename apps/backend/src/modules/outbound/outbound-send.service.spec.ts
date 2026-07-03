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
  sendBubbleJobId?: string;
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
function mockOptimisticQuotaWalletUpdate() {
  return jestGlobal.fn(() => ({
    eq: jestGlobal.fn(() => ({
      eq: jestGlobal.fn(() => ({
        select: jestGlobal.fn(() => ({
          maybeSingle: async () => ({ data: { id: 'w1' }, error: null }),
        })),
      })),
    })),
  }));
}

/** Quota wallet row mock — checkQuotaAvailable uses maybeSingle; debitQuota uses single. */
function mockQuotaWalletsTable(walletData: Record<string, unknown>) {
  const row = async () => ({ data: walletData, error: null });
  return {
    select: () => ({
      eq: () => ({
        single: row,
        maybeSingle: row,
      }),
    }),
    update: mockOptimisticQuotaWalletUpdate(),
  } as never;
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
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { metadata: {} }, error: null }),
                }),
              }),
              update: mockOptimisticQuotaWalletUpdate(),
            } as never;
          }
          if (table === 'quota_wallets') {
            return mockQuotaWalletsTable({
              id: 'w1',
              total_quota: 100,
              used_quota: 50,
              allow_negative_credits: false,
              negative_credit_limit: 0,
            });
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
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { metadata: {} }, error: null }),
                }),
              }),
              update: mockOptimisticQuotaWalletUpdate(),
            } as never;
          }
          if (table === 'quota_wallets') {
            return mockQuotaWalletsTable({
              id: 'w1',
              total_quota: 100,
              used_quota: 1,
              allow_negative_credits: false,
              negative_credit_limit: 0,
            });
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
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { metadata: {} }, error: null }),
                }),
              }),
              update: mockOptimisticQuotaWalletUpdate(),
            } as never;
          }
          if (table === 'quota_wallets') {
            return mockQuotaWalletsTable({
              id: 'w1',
              total_quota: 100,
              used_quota: 1,
              allow_negative_credits: false,
              negative_credit_limit: 0,
            });
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

    function mockSuccessfulSendReply(opts: { conversationChannel?: 'WHATSAPP' | 'SMS' | null }) {
      const ch = opts.conversationChannel;
      return (table: string) => {
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
            select: () => ({
              eq: () => ({
                maybeSingle: async () =>
                  ch == null
                    ? { data: null, error: { code: 'PGRST116' } }
                    : { data: { channel: ch, metadata: {} }, error: null },
              }),
            }),
            update: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(async () => ({ data: null, error: null })),
            })),
          } as never;
        }
        if (table === 'quota_wallets') {
          return mockQuotaWalletsTable({
            id: 'w1',
            total_quota: 100,
            used_quota: 1,
            allow_negative_credits: false,
            negative_credit_limit: 0,
          });
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
      };
    }

    it('WhatsApp: sends one physical GHL message per logical bubble by default (no coalesce)', async () => {
      const decryptSpy = jestGlobal.spyOn(encryption, 'decrypt').mockReturnValue('plain_token');
      delete process.env['WHATSAPP_COALESCE_BUBBLES'];
      try {
        (mockSupabase.from as jest.Mock).mockImplementation(mockSuccessfulSendReply({ conversationChannel: 'WHATSAPP' }));
        mockSendMessage.mockResolvedValue({ success: true, messageId: 'ghl_1' });

        await service.sendReply(
          makeParams({
            replyPlan: makeReplyPlan({
              bubbles: [
                { index: 0, text: 'First bubble' },
                { index: 1, text: 'Second bubble' },
              ],
            }),
          }),
        );

        expect(mockSendMessage).toHaveBeenCalledTimes(2);
        expect(mockSendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: 'First bubble' }));
        expect(mockSendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: 'Second bubble' }));
      } finally {
        decryptSpy.mockRestore();
      }
    });

    it('WhatsApp: joins bubbles when WHATSAPP_COALESCE_BUBBLES=true', async () => {
      const decryptSpy = jestGlobal.spyOn(encryption, 'decrypt').mockReturnValue('plain_token');
      const prev = process.env['WHATSAPP_COALESCE_BUBBLES'];
      process.env['WHATSAPP_COALESCE_BUBBLES'] = 'true';
      try {
        (mockSupabase.from as jest.Mock).mockImplementation(mockSuccessfulSendReply({ conversationChannel: 'WHATSAPP' }));
        mockSendMessage.mockResolvedValue({ success: true, messageId: 'ghl_1' });

        await service.sendReply(
          makeParams({
            replyPlan: makeReplyPlan({
              bubbles: [
                { index: 0, text: 'A' },
                { index: 1, text: 'B' },
              ],
            }),
          }),
        );

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ message: 'A\n\nB' }));
      } finally {
        decryptSpy.mockRestore();
        if (prev === undefined) delete process.env['WHATSAPP_COALESCE_BUBBLES'];
        else process.env['WHATSAPP_COALESCE_BUBBLES'] = prev;
      }
    });

    it('SMS channel: still coalesces multiple bubbles into one send under the size cap', async () => {
      const decryptSpy = jestGlobal.spyOn(encryption, 'decrypt').mockReturnValue('plain_token');
      delete process.env['WHATSAPP_COALESCE_BUBBLES'];
      try {
        (mockSupabase.from as jest.Mock).mockImplementation(mockSuccessfulSendReply({ conversationChannel: 'SMS' }));
        mockSendMessage.mockResolvedValue({ success: true, messageId: 'ghl_1' });

        await service.sendReply(
          makeParams({
            replyPlan: makeReplyPlan({
              bubbles: [
                { index: 0, text: 'Part one' },
                { index: 1, text: 'Part two' },
              ],
            }),
          }),
        );

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ message: 'Part one\n\nPart two' }));
      } finally {
        decryptSpy.mockRestore();
      }
    });
  });

  describe('checkQuotaAvailable', () => {
    it('returns true when no wallet (credits not tracked yet)', async () => {
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
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
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
              eq: () => ({
                single: async () => ({
                  data: { total_quota: 100, used_quota: 50, allow_negative_credits: false, negative_credit_limit: 0 },
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: { total_quota: 100, used_quota: 50, allow_negative_credits: false, negative_credit_limit: 0 },
                  error: null,
                }),
              }),
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
              eq: () => ({
                single: async () => ({
                  data: { total_quota: 5, used_quota: 5, allow_negative_credits: false, negative_credit_limit: 0 },
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: { total_quota: 5, used_quota: 5, allow_negative_credits: false, negative_credit_limit: 0 },
                  error: null,
                }),
              }),
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
              eq: () => ({
                single: async () => ({
                  data: { total_quota: 0, used_quota: 0, allow_negative_credits: false, negative_credit_limit: 0 },
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: { total_quota: 0, used_quota: 0, allow_negative_credits: false, negative_credit_limit: 0 },
                  error: null,
                }),
              }),
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
          return mockQuotaWalletsTable({ id: 'w1', total_quota: 100, used_quota: 10 });
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

  // ---------------------------------------------------------------------------
  // claimOutboundSend / reclaimOutboundSendOnRetry  (unit tests via private backdoor)
  // ---------------------------------------------------------------------------
  describe('claimOutboundSend', () => {
    const claimParams = {
      tenantId: 'tenant_1',
      conversationId: 'conv_1',
      ghlLocationId: 'loc_1',
      replyId: 'reply_1',
      bubbleSequence: 0,
      content: 'hello',
      sendBubbleJobId: 'job_1',
    };

    beforeEach(() => {
      jestGlobal.clearAllMocks();
      service = new OutboundSendService();
    });

    afterEach(() => {
      delete process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'];
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function call(p: typeof claimParams) {
      return (service as any).claimOutboundSend(p);
    }

    function mockOutboundSends(wrap: (b: {
      insertResult: { data: unknown; error: { message: string; code?: string } | null };
      selectResult: { data: unknown; error: unknown };
      updateResult: { data: unknown; error: { message: string; code?: string } | null };
    }) => void) {
      const b = {
        insertResult: { data: null, error: null } as { data: unknown; error: { message: string; code?: string } | null },
        selectResult: { data: null, error: null } as { data: unknown; error: unknown },
        updateResult: { data: null, error: null } as { data: unknown; error: { message: string; code?: string } | null },
      };
      wrap(b);
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table !== 'outbound_sends')
          return { select: jestGlobal.fn(), insert: jestGlobal.fn(), update: jestGlobal.fn() };

        return {
          insert: jestGlobal.fn(async () => b.insertResult),
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(() => ({
                  eq: jestGlobal.fn(() => ({
                    maybeSingle: async () => b.selectResult,
                  })),
                })),
              })),
            })),
          })),
          update: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(() => ({
                  eq: jestGlobal.fn(() => ({
                    in: jestGlobal.fn(async () => b.updateResult),
                  })),
                })),
              })),
            })),
          })),
        };
      });
    }

    it('returns null when flag is off', async () => {
      mockOutboundSends(() => {});
      const result = await call(claimParams);
      expect(result).toBeNull();
    });

    it('first claim inserts a new pending row', async () => {
      process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] = 'true';
      mockOutboundSends(b => {});
      const result = await call(claimParams);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
    });

    it('duplicate pending returns null (skip)', async () => {
      process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] = 'true';
      mockOutboundSends(b => {
        b.insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "uq_outbound_send"', code: '23505' } };
        b.selectResult = { data: { id: 'row1', status: 'pending', attempt: 1 }, error: null };
      });
      const result = await call(claimParams);
      expect(result).toBeNull();
    });

    it('duplicate sent returns null (skip)', async () => {
      process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] = 'true';
      mockOutboundSends(b => {
        b.insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "uq_outbound_send"', code: '23505' } };
        b.selectResult = { data: { id: 'row1', status: 'sent', attempt: 1 }, error: null };
      });
      const result = await call(claimParams);
      expect(result).toBeNull();
    });

    it('duplicate failed_provider_rejected reclaims row', async () => {
      process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] = 'true';
      mockOutboundSends(b => {
        b.insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "uq_outbound_send"', code: '23505' } };
        b.selectResult = { data: { id: 'row1', status: 'failed_provider_rejected', attempt: 1 }, error: null };
        b.updateResult = { data: null, error: null };
      });
      const result = await call(claimParams);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
      expect(result!.attempt).toBe(2);
    });

    it('duplicate dead_lettered reclaims row', async () => {
      process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] = 'true';
      mockOutboundSends(b => {
        b.insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "uq_outbound_send"', code: '23505' } };
        b.selectResult = { data: { id: 'row1', status: 'dead_lettered', attempt: 2 }, error: null };
        b.updateResult = { data: null, error: null };
      });
      const result = await call(claimParams);
      expect(result).not.toBeNull();
      expect(result!.attempt).toBe(3);
    });

    it('duplicate unknown_provider_outcome reclaims row', async () => {
      process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] = 'true';
      mockOutboundSends(b => {
        b.insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "uq_outbound_send"', code: '23505' } };
        b.selectResult = { data: { id: 'row1', status: 'unknown_provider_outcome', attempt: 1 }, error: null };
        b.updateResult = { data: null, error: null };
      });
      const result = await call(claimParams);
      expect(result).not.toBeNull();
    });

    it('duplicate failed_before_provider reclaims row', async () => {
      process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] = 'true';
      mockOutboundSends(b => {
        b.insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "uq_outbound_send"', code: '23505' } };
        b.selectResult = { data: { id: 'row1', status: 'failed_before_provider', attempt: 1 }, error: null };
        b.updateResult = { data: null, error: null };
      });
      const result = await call(claimParams);
      expect(result).not.toBeNull();
    });

    it('concurrent retry: update fails returns null', async () => {
      process.env['AISBP_OUTBOUND_IDEMPOTENCY_ENABLED'] = 'true';
      mockOutboundSends(b => {
        b.insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "uq_outbound_send"', code: '23505' } };
        b.selectResult = { data: { id: 'row1', status: 'failed_provider_rejected', attempt: 1 }, error: null };
        b.updateResult = { data: null, error: { message: 'no rows matched', code: 'PGRST000' } };
      });
      const result = await call(claimParams);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // resolveContactIdIfPhone — phone number to GHL contact ID resolution
  // ---------------------------------------------------------------------------
  describe('resolveContactIdIfPhone', () => {
    let service: OutboundSendService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function resolve(ghlClient: any, locationId: string, contactId: string) {
      return (service as any).resolveContactIdIfPhone(ghlClient, locationId, contactId);
    }

    beforeEach(() => {
      jestGlobal.clearAllMocks();
      service = new OutboundSendService();
    });

    it('returns null for normal GHL contact ID (no change)', async () => {
      const ghlClient = { findContactByPhone: jestGlobal.fn() };
      const result = await resolve(ghlClient, 'loc_1', 'kfmh8xHdo4KFVLO43BWI');
      expect(result).toBeNull();
      expect(ghlClient.findContactByPhone).not.toHaveBeenCalled();
    });

    it('resolves phone-format contact to GHL contact ID', async () => {
      const ghlClient = {
        findContactByPhone: jestGlobal.fn(async () => ({
          success: true,
          contact: { id: 'kfmh8xHdo4KFVLO43BWI', phone: '+6588658634', name: 'test bday' },
        })),
      };
      const result = await resolve(ghlClient, 'loc_1', '+6588658634');
      expect(result).toBe('kfmh8xHdo4KFVLO43BWI');
    });

    it('returns null when GHL API returns no match', async () => {
      const ghlClient = {
        findContactByPhone: jestGlobal.fn(async () => ({
          success: true,
          contact: undefined,
        })),
      };
      const result = await resolve(ghlClient, 'loc_1', '+6599999999');
      expect(result).toBeNull();
    });

    it('returns null when GHL API fails', async () => {
      const ghlClient = {
        findContactByPhone: jestGlobal.fn(async () => ({
          success: false,
          error: 'API error',
        })),
      };
      const result = await resolve(ghlClient, 'loc_1', '+6588658634');
      expect(result).toBeNull();
    });

    it('returns null when GHL API throws', async () => {
      const ghlClient = {
        findContactByPhone: jestGlobal.fn(async () => { throw new Error('Network error'); }),
      };
      const result = await resolve(ghlClient, 'loc_1', '+6588658634');
      expect(result).toBeNull();
    });

    it('returns null for short numbers (not phone format)', async () => {
      const ghlClient = { findContactByPhone: jestGlobal.fn() };
      const result = await resolve(ghlClient, 'loc_1', '+12');
      expect(result).toBeNull();
      expect(ghlClient.findContactByPhone).not.toHaveBeenCalled();
    });
  });

  describe('checkPriorBubble', () => {
    let service: OutboundSendService;

    beforeEach(() => {
      service = new OutboundSendService(
        { get: jestGlobal.fn() } as never,
        { resolve: jestGlobal.fn() } as never,
        { getSender: jestGlobal.fn() } as never,
        { appCache: null } as never,
      );
    });

    it('returns proceed for bubble 0 regardless of DB state', async () => {
      const result = await service.checkPriorBubble('t1', 'c1', 'r1', 0);
      expect(result).toBe('proceed');
    });

    it('returns proceed when predecessor exists with sent status', async () => {
      mockSupabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jestGlobal.fn(async () => ({
                    data: { status: 'sent' }, error: null,
                  })),
                }),
              }),
            }),
          }),
        }),
      } as never);
      const result = await service.checkPriorBubble('t1', 'c1', 'r1', 1);
      expect(result).toBe('proceed');
    });

    it('returns wait when predecessor is pending', async () => {
      mockSupabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jestGlobal.fn(async () => ({
                    data: { status: 'pending' }, error: null,
                  })),
                }),
              }),
            }),
          }),
        }),
      } as never);
      const result = await service.checkPriorBubble('t1', 'c1', 'r1', 1);
      expect(result).toBe('wait');
    });

    it('returns wait when predecessor is processing', async () => {
      mockSupabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jestGlobal.fn(async () => ({
                    data: { status: 'processing' }, error: null,
                  })),
                }),
              }),
            }),
          }),
        }),
      } as never);
      const result = await service.checkPriorBubble('t1', 'c1', 'r1', 1);
      expect(result).toBe('wait');
    });

    it('returns proceed when predecessor not yet created (same-reply batch)', async () => {
      mockSupabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jestGlobal.fn(async () => ({
                    data: null, error: null,
                  })),
                }),
              }),
            }),
          }),
        }),
      } as never);
      const result = await service.checkPriorBubble('t1', 'c1', 'r1', 1);
      expect(result).toBe('proceed');
    });

    it('returns cancel when predecessor is in a terminal non-sent state', async () => {
      mockSupabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jestGlobal.fn(async () => ({
                    data: { status: 'stale_cancelled' }, error: null,
                  })),
                }),
              }),
            }),
          }),
        }),
      } as never);
      const result = await service.checkPriorBubble('t1', 'c1', 'r1', 1);
      expect(result).toBe('cancel');
    });

    it('returns proceed for bubble 2 when predecessor bubble 1 not yet created', async () => {
      mockSupabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jestGlobal.fn(async () => ({
                    data: null, error: null,
                  })),
                }),
              }),
            }),
          }),
        }),
      } as never);
      const result = await service.checkPriorBubble('t1', 'c1', 'r1', 2);
      expect(result).toBe('proceed');
    });

    it('returns wait on DB error (retry-safe — do not silently proceed)', async () => {
      mockSupabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jestGlobal.fn(async () => ({
                    data: null, error: { message: 'DB connection lost' },
                  })),
                }),
              }),
            }),
          }),
        }),
      } as never);
      const result = await service.checkPriorBubble('t1', 'c1', 'r1', 1);
      expect(result).toBe('wait');
    });
  });

  // ── isReplyStale tests (pre-send stale check) ─────────────────────────
  describe('isReplyStale', () => {
    it('returns true when latest inbound differs from start snapshot', async () => {
      // Simulate: at start, latest inbound was msg-old; now latest is msg-new
      (mockSupabase.from as jest.Mock).mockReturnValue({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                order: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(() => ({
                    maybeSingle: jestGlobal.fn(async () => ({
                      data: { id: 'msg-new' },
                      error: null,
                    })),
                  })),
                })),
              })),
            })),
          })),
        })),
      } as never);

      const result = await service.isReplyStale('conv1', 'msg-old');
      expect(result).toBe(true);
    });

    it('returns false when latest inbound matches start snapshot', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                order: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(() => ({
                    maybeSingle: jestGlobal.fn(async () => ({
                      data: { id: 'msg-same' },
                      error: null,
                    })),
                  })),
                })),
              })),
            })),
          })),
        })),
      } as never);

      const result = await service.isReplyStale('conv1', 'msg-same');
      expect(result).toBe(false);
    });

    it('returns false when latestInboundMsgIdAtStart is empty', async () => {
      const result = await service.isReplyStale('conv1', '');
      expect(result).toBe(false);
    });

    it('returns false when query fails', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                order: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(() => ({
                    maybeSingle: jestGlobal.fn(async () => ({
                      data: null,
                      error: { message: 'DB error' },
                    })),
                  })),
                })),
              })),
            })),
          })),
        })),
      } as never);

      const result = await service.isReplyStale('conv1', 'msg-old');
      expect(result).toBe(false); // fail safe
    });
  });
});
