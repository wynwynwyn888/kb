// schedule-orchestration-if-new tests — provider gate, source-aware age, done/lock markers
import { jest as jestGlobal } from '@jest/globals';
import { checkProviderOrchestrationGate, markProviderOrchestrationDone, releaseProviderLock } from './schedule-orchestration-if-new';
import type { AppCacheService } from './app-cache.service';

const mockRedisExists = jestGlobal.fn();
const mockAcquireLock = jestGlobal.fn();
const mockReleaseLock = jestGlobal.fn();
const mockRedisSet = jestGlobal.fn();

function makeAppCache(overrides: Partial<{
  exists: jestGlobal.Mock;
  acquireLock: jestGlobal.Mock;
  releaseLock: jestGlobal.Mock;
  redisSet: jestGlobal.Mock;
}> = {}): AppCacheService {
  return {
    redis: { exists: overrides.exists ?? mockRedisExists, set: overrides.redisSet ?? mockRedisSet },
    acquireLock: overrides.acquireLock ?? mockAcquireLock,
    releaseLock: overrides.releaseLock ?? mockReleaseLock,
  } as unknown as AppCacheService;
}

function makeLogger() {
  return { log: jestGlobal.fn(), warn: jestGlobal.fn(), error: jestGlobal.fn(), debug: jestGlobal.fn() } as never;
}

const baseParams = {
  appCache: undefined as AppCacheService | undefined,
  logger: makeLogger(),
  tenantId: 't1',
  conversationId: 'conv1',
  ghlMessageId: 'ghl-msg-1' as string | null | undefined,
  ghlTimestamp: new Date().toISOString() as string | null | undefined,
  source: 'webhook' as 'webhook' | 'fallback',
};

describe('checkProviderOrchestrationGate', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockRedisExists.mockResolvedValue(0);
    mockAcquireLock.mockResolvedValue('acquired');
    mockReleaseLock.mockResolvedValue(true);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ── Gate 1: no ghlMessageId ──────────────────────────────────────────
  it('webhook: allows when ghlMessageId is missing', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: null,
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('no_ghl_message_id_webhook_allowed');
  });

  it('fallback: blocks when ghlMessageId is missing', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: null,
      source: 'fallback',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_ghl_message_id');
  });

  it('webhook: allows when ghlMessageId is blank', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: '  ',
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('no_ghl_message_id_webhook_allowed');
  });

  it('fallback: blocks when ghlMessageId is blank', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: '  ',
      source: 'fallback',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_ghl_message_id');
  });

  // ── Gate 2: timestamp ─────────────────────────────────────────────────
  it('blocks when timestamp is missing', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlTimestamp: null,
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_timestamp');
  });

  // Gate 2: source-aware max age
  it('webhook: allows within 5 minutes', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlTimestamp: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(true);
  });

  it('webhook: blocks past 5 minutes', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlTimestamp: new Date(Date.now() - 6 * 60_000).toISOString(), // 6 min ago
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('stale_');
  });

  it('fallback: allows within 30 minutes (previously blocked at 5 min)', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlTimestamp: new Date(Date.now() - 6 * 60_000).toISOString(), // 6 min ago
      source: 'fallback',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(true);
  });

  it('fallback: blocks past 30 minutes', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlTimestamp: new Date(Date.now() - 31 * 60_000).toISOString(), // 31 min ago
      source: 'fallback',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('stale_');
  });

  it('fallback: blocks without Redis', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      source: 'fallback',
      appCache: undefined,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_cache');
  });

  it('webhook: allows without Redis', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      source: 'webhook',
      appCache: undefined,
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('no_cache_webhook_allowed');
  });

  // ── Gate 4: done marker ───────────────────────────────────────────────
  it('blocks when done marker exists', async () => {
    mockRedisExists.mockResolvedValue(1); // already done
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('already_done');
  });

  it('webhook: allows through on done check Redis error', async () => {
    mockRedisExists.mockRejectedValue(new Error('Redis down'));
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('done_check_failed_webhook_allowed');
  });

  it('fallback: blocks on done check Redis error', async () => {
    mockRedisExists.mockRejectedValue(new Error('Redis down'));
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      source: 'fallback',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('done_check_failed');
  });

  // ── Gate 5: lock ──────────────────────────────────────────────────────
  it('blocks when lock is held', async () => {
    mockAcquireLock.mockResolvedValue('held');
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      source: 'fallback',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('lock_held');
  });

  it('returns lockToken when acquired', async () => {
    mockAcquireLock.mockResolvedValue('acquired');
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(true);
    expect(r.lockToken).toBeTruthy();
  });
});

describe('markProviderOrchestrationDone', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
  });

  it('sets done marker in Redis', async () => {
    await markProviderOrchestrationDone(makeAppCache(), 't1', 'ghl-msg-1');
    expect(mockRedisSet).toHaveBeenCalledWith(
      'done:orch-provider:t1:ghl-msg-1',
      '1',
      'EX',
      86_400,
    );
  });

  it('no-ops without ghlMessageId', async () => {
    await markProviderOrchestrationDone(makeAppCache(), 't1', null);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('no-ops without appCache', async () => {
    await markProviderOrchestrationDone(undefined, 't1', 'ghl-msg-1');
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('no-ops on Redis error', async () => {
    mockRedisSet.mockRejectedValue(new Error('Redis down'));
    await markProviderOrchestrationDone(makeAppCache(), 't1', 'ghl-msg-1');
    // should not throw
  });
});

describe('releaseProviderLock', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockReleaseLock.mockResolvedValue(true);
  });

  it('releases lock with matching token', async () => {
    await releaseProviderLock(makeAppCache(), 't1', 'ghl-msg-1', 'token-1');
    expect(mockReleaseLock).toHaveBeenCalledWith(
      'lock:orch-provider:t1:ghl-msg-1',
      'token-1',
    );
  });

  it('no-ops without lockToken', async () => {
    await releaseProviderLock(makeAppCache(), 't1', 'ghl-msg-1', undefined);
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  it('no-ops without ghlMessageId', async () => {
    await releaseProviderLock(makeAppCache(), 't1', null, 'token-1');
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });
});
