import { jest as jestGlobal } from '@jest/globals';

// Bypass the cron timer in tests
process.env['BYPASS_FOLLOW_UP_CLEANUP_CRON'] = 'true';

const mockSupabase = {
  from: jestGlobal.fn(),
};
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

import { FollowUpEngineService } from './follow-up-engine.service';

describe('FollowUpEngineService.cleanupStaleFollowUpJobs', () => {
  const followUpSettings = {
    getFollowUpSettings: jestGlobal.fn(async () => ({
      enabled: true, businessHoursOnly: false, activeHoursWindows: {},
      stopOnCustomerReply: true, stopOnBookingCompleted: true,
      stopOnEscalated: true, stopOnOptOut: true, steps: [],
    })),
  };
  const conversations = { isInHandover: jestGlobal.fn(async () => false) };
  const generation = { generateDraft: jestGlobal.fn(async () => ({ content: 'hi' })) };
  const kb = { retrieve: jestGlobal.fn(async () => ({ chunks: [] })) };
  const agencyAiConfig = { getConfig: jestGlobal.fn(async () => ({ activeModel: 'gpt-4o-mini', defaultModel: 'gpt-4o-mini' })) };
  const botProfiles = { getActiveProfile: jestGlobal.fn(async () => ({ systemPrompt: '' })) };
  const outboundSend = { sendReply: jestGlobal.fn(async () => ({ succeeded: 1, failed: 0, totalBubbles: 1, bubbleResults: [] })) };
  const outboundSafetyGovernor = { applyOutboundGovernor: jestGlobal.fn(async (plan: unknown) => plan) };
  const followUpQueue: Record<string, jestGlobal.Mock> = {
    add: jestGlobal.fn(async () => ({})),
    getJob: jestGlobal.fn(async () => null),
  };

  function makeEngine() {
    return new FollowUpEngineService(
      followUpSettings as never,
      conversations as never,
      generation as never,
      kb as never,
      agencyAiConfig as never,
      botProfiles as never,
      outboundSend as never,
      outboundSafetyGovernor as never,
      followUpQueue as never,
    );
  }

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({
                limit: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
            in: () => Promise.resolve({ error: null }),
          }),
          update: () => ({
            eq: () => ({ in: () => Promise.resolve({ error: null }) }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });
  });

  it('returns zero when no stale jobs exist', async () => {
    const engine = makeEngine();
    const result = await engine.cleanupStaleFollowUpJobs();
    expect(result.expired).toBe(0);
    expect(result.skippedPending).toBe(0);
    expect(result.skippedBullExists).toBe(0);
  });

  it('expires stale FAILED jobs older than 7 days', async () => {
    const expiredIds: string[] = [];
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        let calls = 0;
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({
                limit: () => {
                  calls++;
                  if (calls === 1) {
                    return Promise.resolve({ data: [{ id: 'j1' }, { id: 'j2' }], error: null });
                  }
                  return Promise.resolve({ data: [], error: null });
                },
              }),
            }),
            in: () => Promise.resolve({ error: null }),
          }),
          update: () => ({
            eq: () => ({ in: () => Promise.resolve({ error: null }) }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });
    const engine = makeEngine();
    const result = await engine.cleanupStaleFollowUpJobs();
    expect(result.expired).toBe(2);
  });

  it('does not expire PENDING job that still has a BullMQ job', async () => {
    let pendingCall = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({
                limit: () => {
                  pendingCall++;
                  if (pendingCall === 3) {
                    return Promise.resolve({ data: [{ id: 'pending-1' }], error: null });
                  }
                  return Promise.resolve({ data: [], error: null });
                },
              }),
            }),
            in: () => Promise.resolve({ error: null }),
          }),
          update: () => ({
            eq: () => ({ in: () => Promise.resolve({ error: null }) }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });
    (followUpQueue.getJob as jestGlobal.Mock).mockResolvedValueOnce({ id: 'bull-pending-1' });
    const engine = makeEngine();
    const result = await engine.cleanupStaleFollowUpJobs();
    expect(result.skippedBullExists).toBe(1);
    expect(result.expired).toBe(0);
  });

  it('expires orphaned PENDING job with no BullMQ job', async () => {
    let pendingCall = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({
                limit: () => {
                  pendingCall++;
                  if (pendingCall === 3) {
                    return Promise.resolve({ data: [{ id: 'orphan-1' }, { id: 'orphan-2' }], error: null });
                  }
                  return Promise.resolve({ data: [], error: null });
                },
              }),
            }),
            in: () => Promise.resolve({ error: null }),
          }),
          update: () => ({
            eq: () => ({ in: () => Promise.resolve({ error: null }) }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });
    (followUpQueue.getJob as jestGlobal.Mock).mockResolvedValue(null);
    const engine = makeEngine();
    const result = await engine.cleanupStaleFollowUpJobs();
    expect(result.expired).toBe(2);
    expect(result.skippedPending).toBe(2);
  });

  it('is idempotent — second run finds nothing', async () => {
    const engine = makeEngine();
    await engine.cleanupStaleFollowUpJobs();
    const result = await engine.cleanupStaleFollowUpJobs();
    expect(result.expired).toBe(0);
  });

  it('does not throw on DB error', async () => {
    mockSupabase.from.mockImplementation(() => {
      throw new Error('DB error');
    });
    const engine = makeEngine();
    await expect(engine.cleanupStaleFollowUpJobs()).resolves.toEqual({ expired: 0, skippedPending: 0, skippedBullExists: 0 });
  });
});
