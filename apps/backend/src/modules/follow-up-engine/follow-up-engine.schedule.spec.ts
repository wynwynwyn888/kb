import { jest as jestGlobal } from '@jest/globals';
import { Logger } from '@nestjs/common';

const mockSupabase = {
  from: jestGlobal.fn(),
};

let persistedFollowUpRowId = '';

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

import { FollowUpEngineService } from './follow-up-engine.service';

describe('FollowUpEngineService.scheduleAfterOutboundSend', () => {
  const followUpSettings = {
    getFollowUpSettings: jestGlobal.fn(async () => ({
      enabled: true,
      businessHoursOnly: false,
      activeHoursWindows: {},
      stopOnCustomerReply: true,
      stopOnBookingCompleted: true,
      stopOnEscalated: true,
      stopOnOptOut: true,
      steps: [
        {
          enabled: true,
          stepNumber: 1,
          delayAmount: 2,
          delayUnit: 'hours',
          mode: 'fixed_message',
          fixedMessage: 'nudge',
        },
      ],
    })),
  };

  const conversations = { isInHandover: jestGlobal.fn(async () => false) };
  const generation = { generateDraft: jestGlobal.fn() };
  const kb = { retrieve: jestGlobal.fn() };
  const agencyAiConfig = { getConfig: jestGlobal.fn() };
  const botProfiles = { getActivePromptForOrchestration: jestGlobal.fn() };
  const outboundSend = { sendReply: jestGlobal.fn() };
  const outboundSafetyGovernor = { applyOutboundGovernor: jestGlobal.fn(async (p: unknown) => p) };

  const followUpQueue = {
    add: jestGlobal.fn(async () => ({})),
  };

  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let markFailedSpy: jest.SpyInstance;

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
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { metadata: { followUpScheduleVersion: 3 } },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === 'conversation_follow_up_jobs') {
        return {
          insert: jestGlobal.fn(async (payload: { id?: string }) => {
            if (payload?.id) persistedFollowUpRowId = payload.id;
            return { error: null };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    persistedFollowUpRowId = '';
    logSpy = jestGlobal.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jestGlobal.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    markFailedSpy = jestGlobal.spyOn(FollowUpEngineService.prototype as any, 'markJobFailed').mockResolvedValue(undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    markFailedSpy.mockRestore();
  });

  it('enqueues with a BullMQ-safe jobId (no ":") derived from persisted row id', async () => {
    const engine = makeEngine();

    await engine.scheduleAfterOutboundSend({
      tenantId: 't1',
      conversationId: 'conv-1',
      contactId: 'ct1',
      ghlLocationId: 'loc1',
      sentAtIso: '2026-05-06T08:30:45.123Z',
    });

    expect(followUpQueue.add).toHaveBeenCalledTimes(1);
    expect(persistedFollowUpRowId).toMatch(/^[0-9a-f-]{36}$/i);
    const opts = followUpQueue.add.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.jobId).toBe(`followup-${persistedFollowUpRowId}`);
    expect(String(opts.jobId)).not.toMatch(/:/);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('followUpScheduled'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('followUpScheduleEnqueueFailed'));
    expect(markFailedSpy).not.toHaveBeenCalled();
  });

  it('does not throw when dueAtIso contains colons (ISO); jobId stays safe', async () => {
    const engine = makeEngine();

    await expect(
      engine.scheduleAfterOutboundSend({
        tenantId: 't1',
        conversationId: 'conv-1',
        contactId: 'ct1',
        ghlLocationId: 'loc1',
        sentAtIso: '2026-05-06T12:00:00.000Z',
      }),
    ).resolves.toBeUndefined();

    const [, , opts] = followUpQueue.add.mock.calls[0];
    expect((opts as { jobId: string }).jobId).not.toContain(':');
    expect(Number.isFinite((opts as { delay: number }).delay)).toBe(true);
  });

  it('on queue.add failure, marks row FAILED with queue_enqueue_failed and does not log followUpScheduled', async () => {
    followUpQueue.add.mockRejectedValueOnce(new Error('Custom Id cannot contain ":"'));

    const engine = makeEngine();

    await engine.scheduleAfterOutboundSend({
      tenantId: 't1',
      conversationId: 'conv-2',
      contactId: 'ct1',
      ghlLocationId: 'loc1',
      sentAtIso: '2026-05-06T09:00:00.000Z',
    });

    expect(persistedFollowUpRowId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(markFailedSpy).toHaveBeenCalledWith(
      persistedFollowUpRowId,
      'queue_enqueue_failed',
      expect.objectContaining({ bullJobId: `followup-${persistedFollowUpRowId}` }),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('followUpScheduleEnqueueFailed'));
    const scheduledCalls = logSpy.mock.calls.flat().join('\n');
    expect(scheduledCalls).not.toContain('followUpScheduled');
  });

  it('logs followUpScheduled only after queue.add resolves', async () => {
    const order: string[] = [];
    followUpQueue.add.mockImplementation(async () => {
      order.push('add');
      return {};
    });
    logSpy.mockImplementation((msg?: unknown) => {
      if (String(msg).includes('followUpScheduled')) order.push('followUpScheduled');
    });

    const engine = makeEngine();
    await engine.scheduleAfterOutboundSend({
      tenantId: 't1',
      conversationId: 'conv-3',
      contactId: 'ct1',
      ghlLocationId: 'loc1',
      sentAtIso: '2026-05-06T10:00:00.000Z',
    });

    expect(order.indexOf('add')).toBe(0);
    expect(order.indexOf('followUpScheduled')).toBe(1);
  });
});
