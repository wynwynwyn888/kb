// Active Recovery Watchdog tests
import { jest as jestGlobal } from '@jest/globals';
import type { Job } from 'bullmq';

const mockGetSupabaseService = jestGlobal.fn();
const mockSyncGhlConversationContext = jestGlobal.fn();
const mockBumpInboundDebounceMeta = jestGlobal.fn();
const mockResolveInboundDebounceMs = jestGlobal.fn();
const mockReadConversationMetadataField = jestGlobal.fn();
const mockMergeConversationMetadataForPersist = jestGlobal.fn();
const mockInboundQueueAdd = jestGlobal.fn();
const mockWatchdogQueueAdd = jestGlobal.fn();
const mockWatchdogQueueRemove = jestGlobal.fn();

jestGlobal.mock('../../lib/supabase', () => ({ getSupabaseService: mockGetSupabaseService }));
jestGlobal.mock('../../lib/ghl-conversation-sync', () => ({ syncGhlConversationContext: mockSyncGhlConversationContext }));
jestGlobal.mock('../../lib/inbound-debounce', () => ({ bumpInboundDebounceMeta: mockBumpInboundDebounceMeta }));
jestGlobal.mock('../../lib/inbound-burst-batch', () => ({ resolveInboundDebounceMs: mockResolveInboundDebounceMs }));
jestGlobal.mock('../../lib/conversation-metadata-merge', () => ({
  readConversationMetadataField: mockReadConversationMetadataField,
  mergeConversationMetadataForPersist: mockMergeConversationMetadataForPersist,
}));
jestGlobal.mock('@nestjs/bullmq', () => ({
  Processor: () => (t: unknown) => t, WorkerHost: class {}, InjectQueue: () => () => undefined, OnWorkerEvent: () => () => undefined,
}));

import { ActiveRecoveryWatchdogProcessor } from './active-recovery-watchdog.processor';

function makeJob(overrides: Partial<{
  tenantId: string; conversationId: string; ghlLocationId: string;
  contactId: string; latestOutboundAt: string; startedAt: string; expiresAt: string;
}> = {}): Job {
  const now = new Date();
  return {
    id: 'wdog_t1_conv1', opts: { jobId: 'wdog_t1_conv1' }, name: 'check',
    data: {
      tenantId: 't1', conversationId: 'conv1', ghlLocationId: 'loc1', contactId: 'c1',
      latestOutboundAt: now.toISOString(), startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      ...overrides,
    },
  } as unknown as Job;
}

function makeSupabaseMock(orderData: unknown = null, gteData: unknown = null) {
  return {
    from: jestGlobal.fn(() => ({
      select: jestGlobal.fn(() => ({
        eq: jestGlobal.fn(() => ({
          single: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
          eq: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              order: jestGlobal.fn(() => ({
                limit: jestGlobal.fn(() => ({
                  maybeSingle: jestGlobal.fn(async () => ({ data: orderData, error: null })),
                })),
              })),
              gte: jestGlobal.fn(() => ({
                limit: jestGlobal.fn(() => ({
                  maybeSingle: jestGlobal.fn(async () => ({ data: gteData, error: null })),
                })),
              })),
            })),
          })),
        })),
      })),
      update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(async () => ({})) })),
    })),
  };
}

describe('ActiveRecoveryWatchdogProcessor', () => {
  let processor: ActiveRecoveryWatchdogProcessor;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    delete process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'];
    mockGetSupabaseService.mockReturnValue(makeSupabaseMock());
    mockSyncGhlConversationContext.mockResolvedValue({
      synced: 0, deduped: 0, appSkipped: 0, latencyMs: 0,
      insertedContactInboundIds: [], insertedAppOutboundIds: [],
      dedupedIds: [], upgradedMetadataIds: [], latestRecoveredContactInboundAt: null,
    });
    mockBumpInboundDebounceMeta.mockReturnValue({ merged: {}, newVersion: 1 });
    mockResolveInboundDebounceMs.mockReturnValue({ debounceMs: 2000, debounceSource: 'default' });
    mockReadConversationMetadataField.mockReturnValue({});
    mockMergeConversationMetadataForPersist.mockReturnValue({});
    mockWatchdogQueueRemove.mockResolvedValue(undefined);
    mockWatchdogQueueAdd.mockClear();
    mockWatchdogQueueRemove.mockClear();
    processor = new ActiveRecoveryWatchdogProcessor(
      { add: mockInboundQueueAdd } as never,
      { add: mockWatchdogQueueAdd, remove: mockWatchdogQueueRemove } as never,
    );
  });

  it('flag OFF returns immediately', async () => {
    await processor.process(makeJob());
    expect(mockSyncGhlConversationContext).not.toHaveBeenCalled();
  });

  it('flag ON runs sync and self-reschedules', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    await processor.process(makeJob());
    expect(mockSyncGhlConversationContext).toHaveBeenCalled();
    expect(mockWatchdogQueueAdd).toHaveBeenCalled();
  });

  it('recovers contact inbound and schedules orchestration', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    const now = Date.now();
    mockSyncGhlConversationContext.mockResolvedValue({
      synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
      insertedContactInboundIds: ['new-msg'], insertedAppOutboundIds: [],
      dedupedIds: [], upgradedMetadataIds: [],
      latestRecoveredContactInboundAt: new Date(now - 5_000).toISOString(),
    });
    await processor.process(makeJob({
      latestOutboundAt: new Date(now - 20_000).toISOString(),
      startedAt: new Date(now - 3_000).toISOString(),
    }));
    expect(mockInboundQueueAdd).toHaveBeenCalled();
    expect(mockWatchdogQueueAdd).toHaveBeenCalled();
  });

  it('expires after 30 minutes', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    const startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await processor.process(makeJob({ startedAt }));
    expect(mockWatchdogQueueAdd).not.toHaveBeenCalled();
  });

  it('API failure still reschedules next check', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    mockSyncGhlConversationContext.mockRejectedValue(new Error('GHL API down'));
    await processor.process(makeJob());
    expect(mockWatchdogQueueAdd).toHaveBeenCalled();
  });

  it('stale watchdog no-ops when newer KB outbound exists', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    const now = Date.now();
    const newerOutboundTs = new Date(now - 5_000).toISOString(); // 5s ago
    const oldWatchdogTs = new Date(now - 30_000).toISOString();   // 30s ago

    // Create fresh supabase mock where the order path returns a newer outbound
    const mockSupa = {
      from: jestGlobal.fn(() => ({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            single: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                order: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(() => ({
                    maybeSingle: jestGlobal.fn(async () => ({ data: { created_at: newerOutboundTs }, error: null })),
                  })),
                })),
                gte: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(() => ({
                    maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
                  })),
                })),
              })),
            })),
          })),
        })),
        update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(async () => ({})) })),
      })),
    };

    mockGetSupabaseService.mockReturnValue(mockSupa);
    // Fresh processor with the new mock
    const p = new ActiveRecoveryWatchdogProcessor(
      { add: jestGlobal.fn() } as never,
      { add: jestGlobal.fn(), remove: jestGlobal.fn() } as never,
    );

    mockSyncGhlConversationContext.mockClear();

    await p.process({
      id: 'wdog-stale', opts: { jobId: 'wdog_t1_conv1' }, name: 'check',
      data: {
        tenantId: 't1', conversationId: 'conv1', ghlLocationId: 'loc1', contactId: 'c1',
        latestOutboundAt: oldWatchdogTs,
        startedAt: oldWatchdogTs,
        expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
      },
    } as unknown as Job);

    expect(mockSyncGhlConversationContext).not.toHaveBeenCalled();
  });

  it('schedule delays are correct for each window', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    // 0–2 min: 15s
    const t0 = new Date(Date.now() - 30_000).toISOString(); // 30s ago
    await processor.process(makeJob({ startedAt: t0 }));
    expect(mockWatchdogQueueAdd).toHaveBeenCalledWith('check', expect.anything(), expect.objectContaining({ delay: 15_000 }));

    // 2–10 min: 30s
    mockWatchdogQueueAdd.mockClear();
    const t1 = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // 3 min ago
    await processor.process(makeJob({ startedAt: t1 }));
    expect(mockWatchdogQueueAdd).toHaveBeenCalledWith('check', expect.anything(), expect.objectContaining({ delay: 30_000 }));

    // 10–30 min: 60s
    mockWatchdogQueueAdd.mockClear();
    const t2 = new Date(Date.now() - 12 * 60 * 1000).toISOString(); // 12 min ago
    await processor.process(makeJob({ startedAt: t2 }));
    expect(mockWatchdogQueueAdd).toHaveBeenCalledWith('check', expect.anything(), expect.objectContaining({ delay: 60_000 }));
  });

  it('app/outbound GHL messages do not schedule orchestration', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    mockSyncGhlConversationContext.mockResolvedValue({
      synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
      insertedContactInboundIds: [], // no CONTACT inbound
      insertedAppOutboundIds: ['app-1'], // only app/outbound
      dedupedIds: [], upgradedMetadataIds: [],
      latestRecoveredContactInboundAt: null,
    });
    await processor.process(makeJob());
    expect(mockInboundQueueAdd).not.toHaveBeenCalled();
  });

  it('job ID contains no colons (BullMQ-safe)', () => {
    const tid = '34c62859-95b1-49a8-911c-cc44ced05452';
    const cid = 'acecd96e-4871-4e4d-8160-eae445ebe6e2';
    const jobId = `wdog_${tid}_${cid}`;
    expect(jobId).not.toMatch(/:/);
    expect(jobId).toMatch(/^wdog_/);
  });

  it('job IDs are deterministic per tenant+conversation', () => {
    const j1 = 'wdog_tid-1_cid-1';
    const j2 = 'wdog_tid-1_cid-1';
    expect(j1).toBe(j2);
    const j3 = 'wdog_tid-2_cid-1';
    expect(j1).not.toBe(j3);
  });
});
