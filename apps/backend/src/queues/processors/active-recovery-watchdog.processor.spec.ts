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
  Processor: () => (t: unknown) => t,
  WorkerHost: class {},
  InjectQueue: () => () => undefined,
  OnWorkerEvent: () => () => undefined,
}));

import { ActiveRecoveryWatchdogProcessor } from './active-recovery-watchdog.processor';

function makeJob(overrides: Partial<{
  tenantId: string; conversationId: string; ghlLocationId: string;
  contactId: string; latestOutboundAt: string; startedAt: string; expiresAt: string;
}> = {}): Job {
  return {
    id: 'wdog:t1:conv1',
    opts: { jobId: 'wdog:t1:conv1' },
    name: 'check',
    data: {
      tenantId: 't1', conversationId: 'conv1', ghlLocationId: 'loc1', contactId: 'c1',
      latestOutboundAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ...overrides,
    },
  } as unknown as Job;
}

describe('ActiveRecoveryWatchdogProcessor', () => {
  let processor: ActiveRecoveryWatchdogProcessor;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    delete process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'];
    mockGetSupabaseService.mockReturnValue({
      from: jestGlobal.fn(() => ({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            single: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                order: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(() => ({
                    maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
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
    });
    mockSyncGhlConversationContext.mockResolvedValue({
      synced: 0, deduped: 0, appSkipped: 0, latencyMs: 0,
      insertedContactInboundIds: [], insertedAppOutboundIds: [],
      dedupedIds: [], upgradedMetadataIds: [], latestRecoveredContactInboundAt: null,
    });
    mockBumpInboundDebounceMeta.mockReturnValue({ merged: {}, newVersion: 1 });
    mockResolveInboundDebounceMs.mockReturnValue({ debounceMs: 2000, debounceSource: 'default' });
    mockReadConversationMetadataField.mockReturnValue({});
    mockMergeConversationMetadataForPersist.mockReturnValue({});
    const MockInboundQ = { add: mockInboundQueueAdd } as never;
    const MockWatchdogQ = { add: mockWatchdogQueueAdd, remove: mockWatchdogQueueRemove } as never;
    processor = new ActiveRecoveryWatchdogProcessor(MockInboundQ, MockWatchdogQ);
  });

  it('flag OFF returns immediately', async () => {
    await processor.process(makeJob());
    expect(mockSyncGhlConversationContext).not.toHaveBeenCalled();
  });

  it('flag ON runs sync and self-reschedules', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    await processor.process(makeJob());
    expect(mockSyncGhlConversationContext).toHaveBeenCalled();
    // Should self-reschedule (delay = 15s for first 2 min)
    expect(mockWatchdogQueueAdd).toHaveBeenCalled();
  });

  it('recovers contact inbound and schedules orchestration', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    // Fixed timestamps: recovered 5s ago, outbound 20s ago
    const now = Date.now();
    const recovered = new Date(now - 5_000).toISOString();
    const outbound = new Date(now - 20_000).toISOString();
    const started = new Date(now - 3_000).toISOString(); // started 3s ago
    mockSyncGhlConversationContext.mockResolvedValue({
      synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
      insertedContactInboundIds: ['new-msg'], insertedAppOutboundIds: [],
      dedupedIds: [], upgradedMetadataIds: [],
      latestRecoveredContactInboundAt: recovered,
    });
    const job = makeJob({ latestOutboundAt: outbound, startedAt: started });
    await processor.process(job);
    expect(mockInboundQueueAdd).toHaveBeenCalled();
    expect(mockWatchdogQueueAdd).toHaveBeenCalled();
  });

  // TODO: fix mock chain for gte path in already-handled guard
  it.skip('skips already-handled inbound', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    mockGetSupabaseService.mockReturnValue({
      from: jestGlobal.fn(() => ({
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            single: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                order: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(() => ({
                    maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
                  })),
                })),
                gte: jestGlobal.fn(() => ({
                  limit: jestGlobal.fn(() => ({
                    maybeSingle: jestGlobal.fn(async () => ({ data: { id: 'existing-outbound' }, error: null })),
                  })),
                })),
              })),
            })),
          })),
        })),
        update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(async () => ({})) })),
      })),
    });
    mockSyncGhlConversationContext.mockResolvedValue({
      synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
      insertedContactInboundIds: ['new-msg'], insertedAppOutboundIds: [],
      dedupedIds: [], upgradedMetadataIds: [],
      latestRecoveredContactInboundAt: new Date(Date.now() - 5000).toISOString(),
    });
    await processor.process(makeJob({ latestOutboundAt: new Date(Date.now() - 10000).toISOString() }));
    expect(mockInboundQueueAdd).not.toHaveBeenCalled();
  });

  it('expires after 30 minutes', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    const startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min ago
    await processor.process(makeJob({ startedAt }));
    // Should not self-reschedule
    expect(mockWatchdogQueueAdd).not.toHaveBeenCalled();
  });

  it('API failure still reschedules next check', async () => {
    process.env['GHL_ACTIVE_RECOVERY_WATCHDOG_ENABLED'] = 'true';
    mockSyncGhlConversationContext.mockRejectedValue(new Error('GHL API down'));
    await processor.process(makeJob());
    // Should still reschedule
    expect(mockWatchdogQueueAdd).toHaveBeenCalled();
  });
});
