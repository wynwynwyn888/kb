// Unreplied Scanner processor tests — send context resolution, recovery scheduling
import { jest as jestGlobal } from '@jest/globals';
import type { Job } from 'bullmq';

// Mock NestJS infrastructure
jestGlobal.mock('@nestjs/config', () => ({ ConfigService: class {}, ConfigModule: {} }));
jestGlobal.mock('@nestjs/bullmq', () => ({
  Processor: () => (t: unknown) => t,
  WorkerHost: class { process(_job: unknown): unknown { return {}; } },
  InjectQueue: () => () => undefined,
  OnWorkerEvent: () => () => undefined,
}));
jestGlobal.mock('@nestjs/common', () => ({
  Injectable: () => (t: unknown) => t,
  Logger: class { log = jestGlobal.fn(); warn = jestGlobal.fn(); error = jestGlobal.fn(); debug = jestGlobal.fn(); } as any,
  Optional: () => (t: unknown) => t,
}));

// Mock all dependencies
jestGlobal.mock('../../lib/app-cache.service', () => ({ AppCacheService: class {} }));
jestGlobal.mock('../../lib/metrics.service', () => ({ MetricsService: class {} }));
jestGlobal.mock('../../lib/supabase', () => ({ getSupabaseService: () => mockSupabase }));

// Mock decision functions
const mockRecordTerminalDecision = jestGlobal.fn(async () => true);
const mockRecordInterimDecision = jestGlobal.fn(async () => {});
jestGlobal.mock('../../lib/inbound-decision', () => ({
  recordTerminalDecision: mockRecordTerminalDecision,
  recordInterimDecision: mockRecordInterimDecision,
  findUnrepliedInboundMessages: mockFindUnrepliedInboundMessages,
}));

// Mock provider gate
const mockCheckProviderGate = jestGlobal.fn(async () => ({ allowed: true, lockToken: 'token' }));
jestGlobal.mock('../../lib/schedule-orchestration-if-new', () => ({
  checkProviderOrchestrationGate: mockCheckProviderGate,
  markProviderOrchestrationDone: jestGlobal.fn(),
  releaseProviderLock: jestGlobal.fn(),
}));

// Mock debounce
jestGlobal.mock('../../lib/inbound-debounce', () => ({
  bumpInboundDebounceMeta: jestGlobal.fn(() => ({ merged: {}, newVersion: 1 })),
  shouldSkipStaleDebounceJob: jestGlobal.fn(() => false),
}));
jestGlobal.mock('../../lib/inbound-burst-batch', () => ({
  resolveInboundDebounceMs: jestGlobal.fn(() => ({ debounceMs: 2000, debounceSource: 'default' })),
}));
jestGlobal.mock('../../lib/conversation-metadata-merge', () => ({
  readConversationMetadataField: jestGlobal.fn(() => ({})),
  mergeConversationMetadataForPersist: jestGlobal.fn(() => ({})),
}));

// Mock supabase
const mockSupabase = { from: jestGlobal.fn() };
const mockFindUnrepliedInboundMessages = jestGlobal.fn(async () => []);

// Mock inbound queue add
const mockInboundAdd = jestGlobal.fn();

import { UnrepliedScannerProcessor } from './unreplied-scanner.processor';

function makeScannerJob(scanVersion = 0): Job {
  return {
    id: 'scan-1', name: 'scan', opts: { jobId: `unreplied-scanner_v${scanVersion}` },
    data: { startedAt: new Date().toISOString(), scanVersion },
  } as any;
}

function makeCandidate(overrides: Partial<{
  id: string; conversation_id: string; content: string;
  metadata: Record<string, unknown>; created_at: string;
}> = {}): any {
  return {
    id: overrides.id ?? 'msg-1',
    conversation_id: overrides.conversation_id ?? 'conv-1',
    content: overrides.content ?? 'Test message',
    metadata: overrides.metadata ?? { ghlMessageId: 'ghl-test-1', ghlTimestamp: new Date().toISOString() },
    created_at: overrides.created_at ?? new Date().toISOString(),
  };
}

function mockConversationRow(overrides: Partial<{
  tenant_id: string; contact_id: string; metadata: Record<string, unknown>;
  locationId: string;
}> = {}) {
  return {
    tenant_id: overrides.tenant_id ?? 't1',
    contact_id: overrides.contact_id ?? 'c1',
    metadata: {
      ...(overrides.metadata ?? {}),
      ...(overrides.locationId ? { locationId: overrides.locationId } : {}),
    },
  };
}

describe('UnrepliedScannerProcessor — send context', () => {
  let processor: UnrepliedScannerProcessor;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    process.env['UNREPLIED_SCANNER_ENABLED'] = 'true';
    mockCheckProviderGate.mockResolvedValue({ allowed: true, lockToken: 'token' });
    mockInboundAdd.mockResolvedValue(undefined);

    // Default supabase mock: conversation found, no handover
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        // First call: resolve tenant/contact/location
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              single: jestGlobal.fn(async () => ({
                data: mockConversationRow({ locationId: 'loc-from-meta' }),
                error: null,
              })),
            })),
          })),
          update: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(async () => ({ error: null })),
          })),
        };
      }
      if (table === 'handover_events') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        };
      }
      return {
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
            single: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    });

    processor = new UnrepliedScannerProcessor(
      { add: mockInboundAdd } as any,
      { add: jestGlobal.fn() } as any,
      { acquireLock: jestGlobal.fn(), releaseLock: jestGlobal.fn(), redis: { exists: jestGlobal.fn(), set: jestGlobal.fn() } } as any,
    );
  });

  // ── Test 1: Scanner schedules with correct context from conversation ──
  it('schedules orchestration with locationId from conversation metadata and contactId from conversation', async () => {
    mockFindUnrepliedInboundMessages.mockResolvedValue([makeCandidate()]);

    await processor.process(makeScannerJob());

    expect(mockInboundAdd).toHaveBeenCalledTimes(1);
    const addCall = mockInboundAdd.mock.calls[0];
    expect(addCall[0]).toBe('orchestrate');
    const data = addCall[1];
    expect(data.locationId).toBe('loc-from-meta');
    expect(data.ghlContactId).toBe('c1');
    expect(data.tenantId).toBe('t1');
    expect(data.conversationId).toBe('conv-1');
    expect(data.ghlInboundMessageId).toBe('ghl-test-1');
    expect(data.locationId).not.toBe('');
    expect(data.ghlContactId).not.toBe('');
  });

  // ── Test 2: Scanner fallback location from tenant_ghl_connections ────
  it('falls back to tenant_ghl_connections when conversation metadata has no locationId', async () => {
    mockFindUnrepliedInboundMessages.mockResolvedValue([makeCandidate()]);

    // Override conversation mock: no locationId in metadata
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              single: jestGlobal.fn(async () => ({
                data: mockConversationRow({ locationId: undefined as any }), // no locationId in meta
                error: null,
              })),
            })),
          })),
          update: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(async () => ({ error: null })),
          })),
        };
      }
      if (table === 'tenant_ghl_connections') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                maybeSingle: jestGlobal.fn(async () => ({
                  data: { ghl_location_id: 'loc-from-ghl-conn' },
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      if (table === 'handover_events') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        };
      }
      return {
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
            single: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    });

    await processor.process(makeScannerJob());

    expect(mockInboundAdd).toHaveBeenCalledTimes(1);
    const data = mockInboundAdd.mock.calls[0][1];
    expect(data.locationId).toBe('loc-from-ghl-conn');
    expect(data.ghlContactId).toBe('c1');
  });

  // ── Test 3: Missing send context → does NOT schedule ─────────────────
  it('does NOT schedule orchestration when locationId and contactId cannot be resolved', async () => {
    mockFindUnrepliedInboundMessages.mockResolvedValue([makeCandidate()]);

    // Conversation has no locationId in metadata, and no contact_id
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              single: jestGlobal.fn(async () => ({
                data: { tenant_id: 't1', contact_id: null, metadata: {} },
                error: null,
              })),
            })),
          })),
          update: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(async () => ({ error: null })),
          })),
        };
      }
      if (table === 'tenant_ghl_connections') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        };
      }
      if (table === 'handover_events') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        };
      }
      return {
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    });

    await processor.process(makeScannerJob());

    // Should NOT schedule orchestration
    expect(mockInboundAdd).not.toHaveBeenCalled();
    // Should record PENDING_RECOVERY
    expect(mockRecordInterimDecision).toHaveBeenCalled();
    const decisionCall = mockRecordInterimDecision.mock.calls.find(
      (c: any[]) => c[0].decision.status === 'PENDING_RECOVERY' && c[0].decision.reason?.includes('missing send context'),
    );
    expect(decisionCall).toBeDefined();
  });

  // ── Test 4: Provider gate blocked → does NOT schedule ────────────────
  it('does NOT schedule when provider gate blocks', async () => {
    mockFindUnrepliedInboundMessages.mockResolvedValue([makeCandidate()]);
    mockCheckProviderGate.mockResolvedValue({ allowed: false, reason: 'stale' });

    await processor.process(makeScannerJob());

    expect(mockInboundAdd).not.toHaveBeenCalled();
  });

  // ── Test 5: AI off candidate is skipped ──────────────────────────────
  it('skips candidates with ai_status=off', async () => {
    mockFindUnrepliedInboundMessages.mockResolvedValue([makeCandidate()]);

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              single: jestGlobal.fn(async () => ({
                data: mockConversationRow({ locationId: 'loc1', metadata: { ai_status: 'off' } }),
                error: null,
              })),
            })),
          })),
          update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(async () => ({ error: null })) })),
        };
      }
      if (table === 'handover_events') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        };
      }
      return {
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    });

    await processor.process(makeScannerJob());

    expect(mockInboundAdd).not.toHaveBeenCalled();
  });

  // ── Test 6: Handover active candidate gets terminal SKIP without outbound ──
  it('records SKIP_HANDOVER_ACTIVE for candidates with active handover (no outbound)', async () => {
    const candidate = makeCandidate({ ghlMessageId: 'ghl_ho_test' });
    mockFindUnrepliedInboundMessages.mockResolvedValue([candidate]);
    mockRecordTerminalDecision.mockClear();
    const mockMarkDone = jestGlobal.fn();
    jestGlobal.mock('../../lib/schedule-orchestration-if-new', () => ({
      checkProviderOrchestrationGate: mockCheckProviderGate,
      markProviderOrchestrationDone: mockMarkDone,
      releaseProviderLock: jestGlobal.fn(),
    }));

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              single: jestGlobal.fn(async () => ({
                data: mockConversationRow({ locationId: 'loc1', metadata: { ai_status: 'active' } }),
                error: null,
              })),
            })),
          })),
          update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(async () => ({ error: null })) })),
        };
      }
      if (table === 'handover_events') {
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              eq: jestGlobal.fn(() => ({
                maybeSingle: jestGlobal.fn(async () => ({ data: { id: 'he_active' }, error: null })),
              })),
            })),
          })),
        };
      }
      if (table === 'messages') {
        return {
          update: jestGlobal.fn(() => ({ eq: jestGlobal.fn(async () => ({ error: null })) })),
        };
      }
      return {
        select: jestGlobal.fn(() => ({
          eq: jestGlobal.fn(() => ({
            maybeSingle: jestGlobal.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    });

    await processor.process(makeScannerJob());

    // Must write terminal decision
    expect(mockRecordTerminalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: candidate.id,
        decision: expect.objectContaining({
          status: 'SKIP_HANDOVER_ACTIVE',
          reason: 'HANDOVER_ACTIVE_SCANNER_TERMINAL_SKIP',
        }),
      }),
    );
    // Must NOT schedule orchestration
    expect(mockInboundAdd).not.toHaveBeenCalled();
  });
});
