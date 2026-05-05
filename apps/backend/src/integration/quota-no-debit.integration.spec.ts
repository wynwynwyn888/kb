import { jest as jestGlobal } from '@jest/globals';

import { encrypt } from '../lib/encryption';
import * as outboundCoalesce from '../lib/outbound-coalesce';
import { OutboundSendService, SendSummary } from '../modules/outbound/outbound-send.service';
import { createMockSupabase } from '../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

const mockSendMessage = jestGlobal.fn();

jestGlobal.mock('@aisbp/ghl-client', () => ({
  createGhlClient: jestGlobal.fn(() => ({
    sendMessage: mockSendMessage,
  })) as never,
}));

function makeReplyPlan(bubbles: Array<{ index: number; text: string }>) {
  return {
    planStatus: 'PLANNED' as const,
    bubbles,
    responseMode: 'standard' as const,
    handoverRecommended: false,
    confidence: 0.8,
    rationale: 'test',
    suggestedActions: [],
  };
}

function makeParams(bubbles: Array<{ index: number; text: string }>) {
  return {
    tenantId: 'tenant_1',
    conversationId: 'conv_1',
    contactId: 'contact_1',
    ghlLocationId: 'loc_1',
    replyPlan: makeReplyPlan(bubbles),
  };
}

describe('Quota Debit Integration (OutboundSendService)', () => {
  let service: OutboundSendService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    // Quota tests count per logical bubble / send call; disable coalescing here only.
    jestGlobal
      .spyOn(outboundCoalesce, 'maybeCoalesceOutboundBubbles')
      .mockImplementation((bubbles) => bubbles);
    service = new OutboundSendService();

    // Mock credentials found
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockSupabase.from as jest.Mock).mockImplementation((table: string): any => {
      if (table === 'tenant_ghl_connections') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { private_token_encrypted: encrypt('ghl-test-token') },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'messages') {
        return { insert: jestGlobal.fn(async () => ({ data: null, error: null })) };
      }
      if (table === 'conversations') {
        return {
          update: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        };
      }
      if (table === 'quota_ledgers') {
        return { insert: jestGlobal.fn(() => ({ select: jestGlobal.fn(async () => ({ data: null, error: null })) })) };
      }
      if (table === 'quota_wallets') {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: { id: 'w1', total_quota: 100, used_quota: 50 }, error: null }) }),
          }),
          update: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        };
      }
      return {};
    });
  });

  it('debits quota for each successful bubble', async () => {
    mockSendMessage.mockResolvedValue({ success: true, messageId: 'ghl_1' });

    const result: SendSummary = await service.sendReply(makeParams([
      { index: 0, text: 'Bubble 1' },
      { index: 1, text: 'Bubble 2' },
      { index: 2, text: 'Bubble 3' },
    ]));

    expect(result.succeeded).toBe(3);
    expect(result.quotaDebited).toBe(3);
  });

  it('debits zero when all bubble sends fail', async () => {
    mockSendMessage.mockResolvedValue({ success: false, error: 'GHL API error' });

    const result: SendSummary = await service.sendReply(makeParams([
      { index: 0, text: 'Bubble 1' },
      { index: 1, text: 'Bubble 2' },
    ]));

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.quotaDebited).toBe(0);
  });

  it('debits only succeeded bubbles on partial failure', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ success: true, messageId: 'ghl_1' })
      .mockResolvedValueOnce({ success: false, error: 'Rate limited' });

    const result: SendSummary = await service.sendReply(makeParams([
      { index: 0, text: 'Bubble 1' },
      { index: 1, text: 'Bubble 2' },
    ]));

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.quotaDebited).toBe(1);
  });
});
