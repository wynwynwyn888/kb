// PostOutboundSyncProcessor tests — recovery execution, tenant allowlist, guards.

import { jest as jestGlobal } from '@jest/globals';
import type { Job } from 'bullmq';

// Mock modules before importing the processor
const mockGetSupabaseService = jestGlobal.fn();
const mockSyncGhlConversationContext = jestGlobal.fn();
const mockBumpInboundDebounceMeta = jestGlobal.fn();
const mockResolveInboundDebounceMs = jestGlobal.fn();
const mockReadConversationMetadataField = jestGlobal.fn();
const mockMergeConversationMetadataForPersist = jestGlobal.fn();
const mockFormatPostgrestError = jestGlobal.fn((e: unknown) => String(e));
const mockQueueAdd = jestGlobal.fn();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: mockGetSupabaseService,
}));
jestGlobal.mock('../../lib/ghl-conversation-sync', () => ({
  syncGhlConversationContext: mockSyncGhlConversationContext,
}));
jestGlobal.mock('../../lib/inbound-debounce', () => ({
  bumpInboundDebounceMeta: mockBumpInboundDebounceMeta,
}));
jestGlobal.mock('../../lib/inbound-burst-batch', () => ({
  resolveInboundDebounceMs: mockResolveInboundDebounceMs,
}));
jestGlobal.mock('../../lib/conversation-metadata-merge', () => ({
  readConversationMetadataField: mockReadConversationMetadataField,
  mergeConversationMetadataForPersist: mockMergeConversationMetadataForPersist,
}));
jestGlobal.mock('../../lib/format-postgrest-error', () => ({
  formatPostgrestError: mockFormatPostgrestError,
}));

// Suppress NestJS BullMQ decorator processing in test
jestGlobal.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  WorkerHost: class {},
  InjectQueue: () => () => undefined,
  OnWorkerEvent: () => () => undefined,
}));

import { PostOutboundSyncProcessor } from './post-outbound-sync.processor';

// For testing tenant flag logic, we directly test the module-level function
// by mocking process.env

function makeJob(overrides: Partial<{
  tenantId: string; conversationId: string; ghlLocationId: string;
  contactId: string; replyId: string; windowIndex: number; outboundCompletedAt: string;
}> = {}): Job {
  return {
    id: 'job-1',
    name: 'check',
    data: {
      tenantId: 't1',
      conversationId: 'conv-1',
      ghlLocationId: 'loc-1',
      contactId: 'contact-1',
      replyId: 'reply-1',
      windowIndex: 0,
      outboundCompletedAt: '2026-07-01T12:00:00Z',
      ...overrides,
    },
  } as unknown as Job;
}

describe('PostOutboundSyncProcessor', () => {
  let processor: PostOutboundSyncProcessor;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    delete process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'];
    delete process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_TENANTS'];
    mockGetSupabaseService.mockReturnValue({
      from: jestGlobal.fn(() => ({
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
            single: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
          })),
        })),
        update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(async () => ({})) })),
      })),
    });
    mockSyncGhlConversationContext.mockResolvedValue({
      synced: 0, deduped: 0, appSkipped: 0, latencyMs: 0,
      insertedContactInboundIds: [],
      insertedAppOutboundIds: [],
      dedupedIds: [],
      upgradedMetadataIds: [],
      latestRecoveredContactInboundAt: null,
    });
    mockBumpInboundDebounceMeta.mockReturnValue({ merged: {}, newVersion: 5 });
    mockResolveInboundDebounceMs.mockReturnValue({ debounceMs: 2000, debounceSource: 'default' });
    mockReadConversationMetadataField.mockReturnValue({});
    mockMergeConversationMetadataForPersist.mockReturnValue({});
    // Create processor with mock queue
    const MockInboundQueue = { add: mockQueueAdd } as never;
    processor = new PostOutboundSyncProcessor(MockInboundQueue);
  });

  // ===========================================================================
  // Tenant flag: OFF → no-op
  // ===========================================================================

  describe('flag OFF — no-op', () => {
    it('returns immediately when no flags are set', async () => {
      await processor.process(makeJob());
      expect(mockSyncGhlConversationContext).not.toHaveBeenCalled();
    });

    it('returns immediately when GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL is false', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] = 'false';
      await processor.process(makeJob());
      expect(mockSyncGhlConversationContext).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Tenant flag: ON → runs
  // ===========================================================================

  describe('flag ON — runs', () => {
    it('runs when GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL=true', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] = 'true';
      await processor.process(makeJob());
      expect(mockSyncGhlConversationContext).toHaveBeenCalled();
    });

    it('runs when tenant is in GHL_POST_OUTBOUND_RECOVERY_SYNC_TENANTS', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_TENANTS'] = 't1,t2,t3';
      await processor.process(makeJob({ tenantId: 't1' }));
      expect(mockSyncGhlConversationContext).toHaveBeenCalled();
    });

    it('does NOT run when tenant is NOT in GHL_POST_OUTBOUND_RECOVERY_SYNC_TENANTS', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_TENANTS'] = 't2,t3';
      await processor.process(makeJob({ tenantId: 't1' }));
      expect(mockSyncGhlConversationContext).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Recovery: no new CONTACT inbound → no orchestration
  // ===========================================================================

  describe('recovery — no new inbound', () => {
    it('does not schedule orchestration when no contact inbound recovered', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] = 'true';
      mockSyncGhlConversationContext.mockResolvedValue({
        synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
        insertedContactInboundIds: [],
        insertedAppOutboundIds: ['out-1'],
        dedupedIds: [],
        upgradedMetadataIds: [],
        latestRecoveredContactInboundAt: null,
      });
      await processor.process(makeJob());
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Recovery: new CONTACT inbound → schedules orchestration
  // ===========================================================================

  describe('recovery — schedules orchestration', () => {
    it('schedules orchestration when new contact inbound recovered after KB outbound', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] = 'true';
      mockSyncGhlConversationContext.mockResolvedValue({
        synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
        insertedContactInboundIds: ['in-1'],
        insertedAppOutboundIds: [],
        dedupedIds: [],
        upgradedMetadataIds: [],
        latestRecoveredContactInboundAt: '2026-07-01T12:01:00Z', // after outbound at 12:00
      });
      await processor.process(makeJob({ outboundCompletedAt: '2026-07-01T12:00:00Z' }));
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'orchestrate',
        expect.objectContaining({
          tenantId: 't1',
          conversationId: 'conv-1',
          debounceVersion: 5,
        }),
        expect.objectContaining({
          delay: 2000,
        }),
      );
    });

    it('includes debounceVersion from bumpInboundDebounceMeta', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] = 'true';
      mockBumpInboundDebounceMeta.mockReturnValue({ merged: {}, newVersion: 42 });
      mockSyncGhlConversationContext.mockResolvedValue({
        synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
        insertedContactInboundIds: ['in-1'],
        insertedAppOutboundIds: [],
        dedupedIds: [],
        upgradedMetadataIds: [],
        latestRecoveredContactInboundAt: '2026-07-01T12:01:00Z',
      });
      await processor.process(makeJob({ outboundCompletedAt: '2026-07-01T12:00:00Z' }));
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'orchestrate',
        expect.objectContaining({ debounceVersion: 42 }),
        expect.anything(),
      );
    });
  });

  // ===========================================================================
  // Guards: skip app/outbound, already-handled, before KB outbound
  // ===========================================================================

  describe('guard — inbound before KB outbound', () => {
    it('skips when recovered inbound is before the triggering outbound', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] = 'true';
      mockSyncGhlConversationContext.mockResolvedValue({
        synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
        insertedContactInboundIds: ['in-1'],
        insertedAppOutboundIds: [],
        dedupedIds: [],
        upgradedMetadataIds: [],
        latestRecoveredContactInboundAt: '2026-07-01T11:59:00Z', // BEFORE outbound at 12:00
      });
      await processor.process(makeJob({ outboundCompletedAt: '2026-07-01T12:00:00Z' }));
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe('guard — already handled', () => {
    it('skips when a KB outbound already exists after recovered inbound', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] = 'true';
      // Create fresh supabase mock with already-handled response
      const handledSingle = jestGlobal.fn(async () => ({
        data: { id: 'later-outbound' }, error: null,
      }));
      mockGetSupabaseService.mockReturnValue({
        from: jestGlobal.fn((_table: string) => {
          if (_table === 'messages') {
            return {
              select: jestGlobal.fn(() => ({
                eq: jestGlobal.fn(() => ({
                  eq: jestGlobal.fn(() => ({
                    eq: jestGlobal.fn(() => ({
                      gte: jestGlobal.fn(() => ({
                        limit: jestGlobal.fn(() => ({
                          maybeSingle: handledSingle,
                        })),
                      })),
                    })),
                  })),
                })),
              })),
            };
          }
          return {
            select: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                single: jestGlobal.fn(async () => ({ data: { metadata: {} }, error: null })),
              })),
            })),
            update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(async () => ({})) })),
          };
        }),
      });
      mockSyncGhlConversationContext.mockResolvedValue({
        synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
        insertedContactInboundIds: ['in-1'],
        insertedAppOutboundIds: [],
        dedupedIds: [],
        upgradedMetadataIds: [],
        latestRecoveredContactInboundAt: '2026-07-01T12:01:00Z',
      });
      const MockInboundQueue = { add: mockQueueAdd } as never;
      const p = new PostOutboundSyncProcessor(MockInboundQueue);
      await p.process(makeJob({ outboundCompletedAt: '2026-07-01T12:00:00Z' }));
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe('guard — outside recovery horizon', () => {
    it('skips when recovered inbound is more than 5 minutes after outbound', async () => {
      process.env['GHL_POST_OUTBOUND_RECOVERY_SYNC_ALL'] = 'true';
      mockSyncGhlConversationContext.mockResolvedValue({
        synced: 1, deduped: 0, appSkipped: 0, latencyMs: 100,
        insertedContactInboundIds: ['in-1'],
        insertedAppOutboundIds: [],
        dedupedIds: [],
        upgradedMetadataIds: [],
        latestRecoveredContactInboundAt: '2026-07-01T12:10:00Z', // 10 min after outbound
      });
      await processor.process(makeJob({ outboundCompletedAt: '2026-07-01T12:00:00Z' }));
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });
});
