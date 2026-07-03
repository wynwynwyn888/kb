// Inbound decision record tests — durable per-message decision tracking
import { jest as jestGlobal } from '@jest/globals';

import {
  recordTerminalDecision,
  recordInterimDecision,
  recordDuplicateDecision,
  isTerminalDecision,
  findUnrepliedInboundMessages,
} from './inbound-decision';
import type { InboundDecisionRecord } from './inbound-decision';

const mockSupabaseFrom = jestGlobal.fn();
const mockSupabase = { from: mockSupabaseFrom };

function makeLogger() {
  return { log: jestGlobal.fn(), warn: jestGlobal.fn(), error: jestGlobal.fn(), debug: jestGlobal.fn() } as any;
}

function mockMessageMeta(metadata: Record<string, unknown> | null) {
  mockSupabaseFrom.mockReturnValue({
    select: jestGlobal.fn(() => ({
      eq: jestGlobal.fn(() => ({
        maybeSingle: jestGlobal.fn(async () => ({
          data: metadata !== null ? { metadata } : null,
          error: null,
        })),
        single: jestGlobal.fn(async () => ({
          data: metadata !== null ? { metadata } : null,
          error: null,
        })),
      })),
    })),
    update: jestGlobal.fn(() => ({
      eq: jestGlobal.fn(async () => ({ error: null })),
    })),
  } as any);
}

function mockMessagesQuery(data: Array<Record<string, unknown>> | null) {
  mockSupabaseFrom.mockReturnValue({
    select: jestGlobal.fn(() => ({
      eq: jestGlobal.fn(() => ({
        eq: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            gte: jestGlobal.fn(() => ({
              order: jestGlobal.fn(() => ({
                limit: jestGlobal.fn(() => data),
              })),
            })),
            maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        })),
      })),
    })),
    update: jestGlobal.fn(() => ({
      eq: jestGlobal.fn(async () => ({ error: null })),
    })),
  } as any);
}

describe('inbound-decision', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
  });

  // ── isTerminalDecision ─────────────────────────────────────────────
  describe('isTerminalDecision', () => {
    it('PROCEED is terminal', () => expect(isTerminalDecision('PROCEED')).toBe(true));
    it('SKIP_AI_OFF_TAG is terminal', () => expect(isTerminalDecision('SKIP_AI_OFF_TAG')).toBe(true));
    it('SKIP_DUPLICATE_PROVIDER_DONE is terminal', () => expect(isTerminalDecision('SKIP_DUPLICATE_PROVIDER_DONE')).toBe(true));
    it('SKIP_HUMAN_TAKEOVER is terminal', () => expect(isTerminalDecision('SKIP_HUMAN_TAKEOVER')).toBe(true));
    it('PENDING is not terminal', () => expect(isTerminalDecision('PENDING')).toBe(false));
    it('FAILED_SEND is not terminal', () => expect(isTerminalDecision('FAILED_SEND')).toBe(false));
    it('PENDING_RECOVERY is not terminal', () => expect(isTerminalDecision('PENDING_RECOVERY')).toBe(false));
    it('RECOVERY_SCHEDULED is not terminal', () => expect(isTerminalDecision('RECOVERY_SCHEDULED')).toBe(false));
  });

  // ── recordTerminalDecision ─────────────────────────────────────────
  describe('recordTerminalDecision', () => {
    it('records PROCEED with outbound ID', async () => {
      mockMessageMeta({});
      const result = await recordTerminalDecision({
        supabase: mockSupabase as any,
        logger: makeLogger(),
        messageId: 'msg-1',
        decision: {
          status: 'PROCEED',
          outboundMessageId: 'reply-1',
          outboundGhlMessageId: 'ghl-out-1',
          triggerSource: 'webhook',
          decidedAt: new Date().toISOString(),
        },
      });
      expect(result).toBe(true);
    });

    it('records SKIP_AI_OFF_TAG with reason', async () => {
      mockMessageMeta({});
      const result = await recordTerminalDecision({
        supabase: mockSupabase as any,
        logger: makeLogger(),
        messageId: 'msg-2',
        decision: {
          status: 'SKIP_AI_OFF_TAG',
          reason: 'ai_status=off (metadata)',
          triggerSource: 'webhook',
          decidedAt: new Date().toISOString(),
        },
      });
      expect(result).toBe(true);
    });

    it('does NOT overwrite an existing terminal decision', async () => {
      mockMessageMeta({ inbound_decision: { status: 'SKIP_AI_OFF_TAG' } as InboundDecisionRecord });
      const result = await recordTerminalDecision({
        supabase: mockSupabase as any,
        logger: makeLogger(),
        messageId: 'msg-3',
        decision: {
          status: 'PROCEED',
          triggerSource: 'scanner',
          decidedAt: new Date().toISOString(),
        },
      });
      expect(result).toBe(true); // returns true because already terminal
    });

    it('returns true when already terminal (no overwrite)', async () => {
      mockMessageMeta({ inbound_decision: { status: 'PROCEED' } as InboundDecisionRecord });
      const result = await recordTerminalDecision({
        supabase: mockSupabase as any,
        logger: makeLogger(),
        messageId: 'msg-10',
        decision: {
          status: 'SKIP_AI_OFF_TAG',
          triggerSource: 'scanner',
          decidedAt: new Date().toISOString(),
        },
      });
      expect(result).toBe(true);
    });

    it('returns false for non-terminal status', async () => {
      mockMessageMeta({});
      const logger = makeLogger();
      const result = await recordTerminalDecision({
        supabase: mockSupabase as any,
        logger,
        messageId: 'msg-4',
        decision: {
          status: 'FAILED_SEND',
          triggerSource: 'webhook',
          decidedAt: new Date().toISOString(),
        },
      });
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('logs error on write failure', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            maybeSingle: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
          })),
        })),
        update: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(async () => ({ error: { message: 'DB error' } })),
        })),
      } as any);
      const logger = makeLogger();
      const result = await recordTerminalDecision({
        supabase: mockSupabase as any,
        logger,
        messageId: 'msg-5',
        decision: {
          status: 'SKIP_AI_OFF_TAG',
          triggerSource: 'webhook',
          decidedAt: new Date().toISOString(),
        },
      });
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ── recordInterimDecision ──────────────────────────────────────────
  describe('recordInterimDecision', () => {
    it('records PENDING interim decision', async () => {
      mockMessageMeta({});
      await recordInterimDecision({
        supabase: mockSupabase as any,
        messageId: 'msg-6',
        decision: {
          status: 'PENDING',
          triggerSource: 'webhook',
          decidedAt: new Date().toISOString(),
        },
      });
      // Should not throw
    });

    it('does not overwrite terminal decision', async () => {
      mockMessageMeta({ inbound_decision: { status: 'PROCEED' } as InboundDecisionRecord });
      await recordInterimDecision({
        supabase: mockSupabase as any,
        messageId: 'msg-7',
        decision: {
          status: 'PENDING_RECOVERY',
          triggerSource: 'scanner',
          decidedAt: new Date().toISOString(),
        },
      });
      // Should not throw or overwrite
    });
  });

  // ── recordDuplicateDecision ────────────────────────────────────────
  describe('recordDuplicateDecision', () => {
    it('records SKIP_DUPLICATE_PROVIDER_DONE for duplicate message', async () => {
      mockMessageMeta({});
      await recordDuplicateDecision({
        supabase: mockSupabase as any,
        logger: makeLogger(),
        duplicateMessageId: 'dup-1',
        existingProviderMessageId: 'ghl-abc',
      });
      // Should record terminal duplicate
    });
  });

  // ── Decision update payload (no updated_at) ──────────────────────────
  describe('update payload shape', () => {
    it('recordTerminalDecision update does NOT include updated_at', async () => {
      let updatePayload: Record<string, unknown> = {};
      mockSupabaseFrom.mockReturnValue({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            maybeSingle: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
          })),
        })),
        update: jestGlobal.fn((payload: Record<string, unknown>) => {
          updatePayload = payload;
          return { eq: jestGlobal.fn(async () => ({ error: null })) };
        }),
      } as any);

      await recordTerminalDecision({
        supabase: mockSupabase as any,
        logger: makeLogger(),
        messageId: 'msg-payload',
        decision: {
          status: 'PROCEED',
          outboundMessageId: 'r1',
          triggerSource: 'webhook',
          decidedAt: new Date().toISOString(),
        },
      });

      expect(updatePayload).toHaveProperty('metadata');
      expect(updatePayload).not.toHaveProperty('updated_at');
      expect(updatePayload).not.toHaveProperty('updatedAt');
      // Only metadata should be present (no extra columns)
      expect(Object.keys(updatePayload)).toEqual(['metadata']);
    });

    it('recordInterimDecision update does NOT include updated_at', async () => {
      let updatePayload: Record<string, unknown> = {};
      mockSupabaseFrom.mockReturnValue({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            maybeSingle: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
          })),
        })),
        update: jestGlobal.fn((payload: Record<string, unknown>) => {
          updatePayload = payload;
          return { eq: jestGlobal.fn(async () => ({ error: null })) };
        }),
      } as any);

      await recordInterimDecision({
        supabase: mockSupabase as any,
        messageId: 'msg-payload-2',
        decision: {
          status: 'PENDING',
          triggerSource: 'webhook',
          decidedAt: new Date().toISOString(),
        },
      });

      expect(updatePayload).toHaveProperty('metadata');
      expect(updatePayload).not.toHaveProperty('updated_at');
      expect(updatePayload).not.toHaveProperty('updatedAt');
      expect(Object.keys(updatePayload)).toEqual(['metadata']);
    });
  });

  // ── findUnrepliedInboundMessages ────────────────────────────────────
  describe('findUnrepliedInboundMessages', () => {
    it('returns empty when no candidates', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              gte: jestGlobal.fn(() => ({
                order: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(async () => ({ data: [], error: null })),
                })),
              })),
            })),
          })),
        })),
      } as any);

      const result = await findUnrepliedInboundMessages({
        supabase: mockSupabase as any,
        lookbackMinutes: 30,
        limit: 50,
      });
      expect(result).toHaveLength(0);
    });

    it('finds unreplied messages without terminal decisions', async () => {
      // We need a mock that returns candidates AND later outbound checks
      let callCount = 0;
      mockSupabaseFrom.mockImplementation((_table: string) => {
        callCount++;
        if (callCount <= 1) {
          // First call: candidates query
          return {
            select: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(() => ({
                  gte: jestGlobal.fn(() => ({
                    order: jestGlobal.fn(() => ({
                      limit: jestGlobal.fn(async () => ({
                        data: [
                          {
                            id: 'cand-1',
                            conversation_id: 'conv1',
                            content: 'Hi',
                            metadata: {},
                            created_at: new Date().toISOString(),
                          },
                        ],
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
            })),
          } as any;
        }
        // Subsequent calls: later outbound check
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(() => ({
                  gte: jestGlobal.fn(() => ({
                    limit: jestGlobal.fn(() => ({
                      maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
                    })),
                  })),
                })),
              })),
            })),
          })),
        } as any;
      });

      const result = await findUnrepliedInboundMessages({
        supabase: mockSupabase as any,
        lookbackMinutes: 30,
        limit: 50,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cand-1');
    });
  });
});
