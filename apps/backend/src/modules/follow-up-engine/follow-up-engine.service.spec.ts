import { jest as jestGlobal } from '@jest/globals';

const mockSupabase = {
  from: jestGlobal.fn(),
};

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

import { FollowUpEngineService } from './follow-up-engine.service';

describe('FollowUpEngineService.processFollowUpJob', () => {
  const followUpSettings = {
    getFollowUpSettings: jestGlobal.fn(async () => ({
      enabled: true,
      businessHoursOnly: false,
      activeHoursWindows: {},
      stopOnCustomerReply: true,
      stopOnBookingCompleted: true,
      stopOnEscalated: true,
      stopOnOptOut: true,
      steps: [],
    })),
  };

  const conversations = {
    isInHandover: jestGlobal.fn(async () => false),
  };

  const generation = {
    generateDraft: jestGlobal.fn(async () => ({ content: 'hi' })),
  };

  const kb = {
    retrieve: jestGlobal.fn(async () => ({ chunks: [] })),
  };

  const agencyAiConfig = {
    getConfig: jestGlobal.fn(async () => ({ activeModel: 'gpt-4o-mini', defaultModel: 'gpt-4o-mini' })),
  };

  const botProfiles = {
    getActiveProfile: jestGlobal.fn(async () => ({ systemPrompt: '' })),
  };

  const outboundSend = {
    sendReply: jestGlobal.fn(async () => ({ succeeded: 1, failed: 0, totalBubbles: 1, bubbleResults: [] })),
  };

  const outboundSafetyGovernor = {
    applyOutboundGovernor: jestGlobal.fn(async (plan: unknown) => plan),
  };

  const followUpQueue = {
    add: jestGlobal.fn(async () => ({})),
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
  });

  it('skips stale schedule version', async () => {
    const engine = makeEngine();
    (engine as any).getConversationFollowUpScheduleVersion = jestGlobal.fn(async () => 2);
    (engine as any).markJobSkipped = jestGlobal.fn(async () => {});

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'job_1',
                  status: 'PENDING',
                  tenant_id: 't1',
                  conversation_id: 'c1',
                  contact_id: 'ct1',
                  ghl_location_id: 'loc1',
                  schedule_version: 1,
                  scheduled_at: '2026-01-01T00:00:00.000Z',
                  step_number: 1,
                  step_snapshot_json: { mode: 'fixed_message', fixedMessage: 'hello' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await engine.processFollowUpJob('job_1');

    expect((engine as any).markJobSkipped).toHaveBeenCalledWith(
      'job_1',
      'stale_schedule_version',
      expect.objectContaining({ curVer: 2, scheduleVersion: 1 }),
    );
    expect(outboundSend.sendReply).not.toHaveBeenCalled();
  });

  it('skips when customer replied after scheduledAt', async () => {
    const engine = makeEngine();
    (engine as any).getConversationFollowUpScheduleVersion = jestGlobal.fn(async () => 1);
    (engine as any).hasInboundAfter = jestGlobal.fn(async () => true);
    (engine as any).markJobSkipped = jestGlobal.fn(async () => {});

    followUpSettings.getFollowUpSettings.mockResolvedValueOnce({
      enabled: true,
      businessHoursOnly: false,
      activeHoursWindows: {},
      stopOnCustomerReply: true,
      stopOnBookingCompleted: false,
      stopOnEscalated: false,
      stopOnOptOut: false,
      steps: [],
    });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'job_2',
                  status: 'PENDING',
                  tenant_id: 't1',
                  conversation_id: 'c1',
                  contact_id: 'ct1',
                  ghl_location_id: 'loc1',
                  schedule_version: 1,
                  scheduled_at: '2026-01-01T00:00:00.000Z',
                  step_number: 1,
                  step_snapshot_json: { mode: 'fixed_message', fixedMessage: 'hello' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await engine.processFollowUpJob('job_2');

    expect((engine as any).markJobSkipped).toHaveBeenCalledWith('job_2', 'customer_replied_after_scheduled');
    expect(outboundSend.sendReply).not.toHaveBeenCalled();
  });

  it('defers outside active hours (does not drop)', async () => {
    const engine = makeEngine();
    (engine as any).getConversationFollowUpScheduleVersion = jestGlobal.fn(async () => 1);
    (engine as any).resolveTenantTimeZone = jestGlobal.fn(async () => 'Asia/Singapore');
    (engine as any).isWithinActiveHours = jestGlobal.fn(() => false);
    (engine as any).computeNextActiveWindowUtcMs = jestGlobal.fn(() => Date.now() + 60_000);
    (engine as any).deferJob = jestGlobal.fn(async () => {});

    followUpSettings.getFollowUpSettings.mockResolvedValueOnce({
      enabled: true,
      businessHoursOnly: true,
      activeHoursWindows: { mon: [{ start: '09:00', end: '17:00' }] },
      stopOnCustomerReply: false,
      stopOnBookingCompleted: false,
      stopOnEscalated: false,
      stopOnOptOut: false,
      steps: [],
    });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'job_3',
                  status: 'PENDING',
                  tenant_id: 't1',
                  conversation_id: 'c1',
                  contact_id: 'ct1',
                  ghl_location_id: 'loc1',
                  schedule_version: 1,
                  scheduled_at: '2026-01-01T00:00:00.000Z',
                  step_number: 1,
                  step_snapshot_json: { mode: 'fixed_message', fixedMessage: 'hello' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await engine.processFollowUpJob('job_3');

    expect((engine as any).deferJob).toHaveBeenCalledWith(
      'job_3',
      expect.any(String),
      'outside_active_hours',
      expect.objectContaining({ tenantTz: 'Asia/Singapore' }),
    );
    expect(outboundSend.sendReply).not.toHaveBeenCalled();
  });

  it('skips when no active windows configured', async () => {
    const engine = makeEngine();
    (engine as any).getConversationFollowUpScheduleVersion = jestGlobal.fn(async () => 1);
    (engine as any).resolveTenantTimeZone = jestGlobal.fn(async () => 'Asia/Singapore');
    (engine as any).isWithinActiveHours = jestGlobal.fn(() => false);
    (engine as any).computeNextActiveWindowUtcMs = jestGlobal.fn(() => null);
    (engine as any).markJobSkipped = jestGlobal.fn(async () => {});

    followUpSettings.getFollowUpSettings.mockResolvedValueOnce({
      enabled: true,
      businessHoursOnly: true,
      activeHoursWindows: {},
      stopOnCustomerReply: false,
      stopOnBookingCompleted: false,
      stopOnEscalated: false,
      stopOnOptOut: false,
      steps: [],
    });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'job_4',
                  status: 'PENDING',
                  tenant_id: 't1',
                  conversation_id: 'c1',
                  contact_id: 'ct1',
                  ghl_location_id: 'loc1',
                  schedule_version: 1,
                  scheduled_at: '2026-01-01T00:00:00.000Z',
                  step_number: 1,
                  step_snapshot_json: { mode: 'fixed_message', fixedMessage: 'hello' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await engine.processFollowUpJob('job_4');

    expect((engine as any).markJobSkipped).toHaveBeenCalledWith('job_4', 'no_active_windows_configured');
    expect(outboundSend.sendReply).not.toHaveBeenCalled();
  });

  it('applies outbound safety governor before sending', async () => {
    const engine = makeEngine();
    (engine as any).getConversationFollowUpScheduleVersion = jestGlobal.fn(async () => 1);
    (engine as any).resolveTenantTimeZone = jestGlobal.fn(async () => 'Asia/Singapore');
    (engine as any).hasInboundAfter = jestGlobal.fn(async () => false);
    (engine as any).isConversationOptedOut = jestGlobal.fn(async () => false);

    followUpSettings.getFollowUpSettings.mockResolvedValueOnce({
      enabled: true,
      businessHoursOnly: false,
      activeHoursWindows: {},
      stopOnCustomerReply: true,
      stopOnBookingCompleted: true,
      stopOnEscalated: true,
      stopOnOptOut: true,
      steps: [],
    });

    outboundSafetyGovernor.applyOutboundGovernor.mockImplementationOnce(async (plan: any) => ({
      ...plan,
      bubbles: [{ index: 0, text: 'governed' }],
    }));

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'job_5',
                  status: 'PENDING',
                  tenant_id: 't1',
                  conversation_id: 'c1',
                  contact_id: 'ct1',
                  ghl_location_id: 'loc1',
                  schedule_version: 1,
                  scheduled_at: '2026-01-01T00:00:00.000Z',
                  step_number: 1,
                  step_snapshot_json: { mode: 'fixed_message', fixedMessage: 'original' },
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({}),
          }),
        };
      }
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { metadata: { followUpScheduleVersion: 1 } }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === 'handover_events') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      if (table === 'messages') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await engine.processFollowUpJob('job_5');

    expect(outboundSafetyGovernor.applyOutboundGovernor).toHaveBeenCalled();
    expect(outboundSend.sendReply).toHaveBeenCalledWith(
      expect.objectContaining({
        sendBubbleJobId: 'follow_up:job_5',
        replyPlan: expect.objectContaining({
          bubbles: [{ index: 0, text: 'governed' }],
        }),
      }),
    );
  });

  it('cancelPendingJobsForHumanEscalation bumps schedule and marks pending jobs skipped', async () => {
    const engine = makeEngine();
    (engine as any).bumpFollowUpScheduleVersion = jestGlobal.fn(async () => 7);
    const jobUpdate = jestGlobal.fn().mockReturnValue({
      eq: jestGlobal.fn().mockReturnValue({
        eq: async () => ({ error: null }),
      }),
    });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversation_follow_up_jobs') {
        return {
          select: jestGlobal.fn().mockReturnValue({
            eq: jestGlobal.fn().mockReturnValue({
              eq: async () => ({ data: [{ id: 'job_pending_1' }] }),
            }),
          }),
          update: jobUpdate,
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await engine.cancelPendingJobsForHumanEscalation({ tenantId: 't1', conversationId: 'c1' });

    expect((engine as any).bumpFollowUpScheduleVersion).toHaveBeenCalledWith('c1', 'human_escalated');
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SKIPPED',
        decision_reason: 'human_escalated',
      }),
    );
  });
});

