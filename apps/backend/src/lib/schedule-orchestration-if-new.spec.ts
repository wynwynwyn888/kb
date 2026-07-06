// schedule-orchestration-if-new tests — provider gate, fallback identity, source-aware age, done/lock markers
import { jest as jestGlobal } from '@jest/globals';
import { checkProviderOrchestrationGate, markProviderOrchestrationDone, releaseProviderLock, resolveProviderIdentity } from './schedule-orchestration-if-new';
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

describe('resolveProviderIdentity', () => {
  it('returns ghl_message_id when ghlMessageId provided', () => {
    const id = resolveProviderIdentity({ ghlMessageId: 'ghl-1' });
    expect(id).toEqual({ kind: 'ghl_message_id', value: 'ghl-1' });
  });

  it('prefers ghlMessageId over kbMessageId', () => {
    const id = resolveProviderIdentity({ ghlMessageId: 'ghl-1', kbMessageId: 'kb-1' });
    expect(id).toEqual({ kind: 'ghl_message_id', value: 'ghl-1' });
  });

  it('falls back to kb_fallback when ghlMessageId missing', () => {
    const id = resolveProviderIdentity({ kbMessageId: 'kb-1' });
    expect(id).toEqual({ kind: 'kb_fallback', value: 'kb-1' });
  });

  it('returns null when neither provided', () => {
    const id = resolveProviderIdentity({});
    expect(id).toBeNull();
  });

  it('trims whitespace', () => {
    const id = resolveProviderIdentity({ ghlMessageId: '  ghl-1  ' });
    expect(id).toEqual({ kind: 'ghl_message_id', value: 'ghl-1' });
  });
});

describe('checkProviderOrchestrationGate', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockRedisExists.mockResolvedValue(0);
    mockAcquireLock.mockResolvedValue('acquired');
    mockReleaseLock.mockResolvedValue(true);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ── Gate 1a: no provider identity ──────────────────────────────────────
  it('blocks when neither ghlMessageId nor kbMessageId provided', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: null,
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_provider_identity');
  });

  it('blocks when ghlMessageId is blank and no kbMessageId', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: '  ',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_provider_identity');
  });

  // ── Gate 1b: fallback identity when ghlMessageId missing but kbMessageId present ──
  it('allows with kb_fallback identity when ghlMessageId missing', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: null,
      kbMessageId: 'kb-msg-1',
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(true);
    expect(r.identity).toEqual({ kind: 'kb_fallback', value: 'kb-msg-1' });
  });

  it('uses kb_fallback lock key space distinct from ghl lock keys', async () => {
    mockAcquireLock.mockResolvedValue('acquired');
    await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: null,
      kbMessageId: 'kb-msg-1',
      source: 'webhook',
      appCache: makeAppCache(),
    });
    // Should use fallback lock key, not ghl lock key
    expect(mockAcquireLock).toHaveBeenCalledWith(
      'lock:orch-provider-fallback:t1:kb-msg-1',
      expect.any(String),
      120,
    );
  });

  // ── Gate 2: timestamp (only checked when provided) ─────────────────────
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

  it('allows when timestamp is missing (best-effort with identity)', async () => {
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      ghlTimestamp: null,
      source: 'webhook',
      appCache: makeAppCache(),
    });
    // With valid ghlMessageId and no timestamp, should still allow (best-effort)
    expect(r.allowed).toBe(true);
  });

  // Gate 2: source-aware max age
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

  it('uses ghl done key for ghl_message_id identity', async () => {
    mockRedisExists.mockResolvedValue(0);
    await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: 'ghl-msg-1',
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(mockRedisExists).toHaveBeenCalledWith('done:orch-provider:t1:ghl-msg-1');
  });

  it('uses fallback done key for kb_fallback identity', async () => {
    mockRedisExists.mockResolvedValue(0);
    await checkProviderOrchestrationGate({
      ...baseParams,
      ghlMessageId: null,
      kbMessageId: 'kb-msg-1',
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(mockRedisExists).toHaveBeenCalledWith('done:orch-provider-fallback:t1:kb-msg-1');
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

  it('returns lockToken and identity when acquired', async () => {
    mockAcquireLock.mockResolvedValue('acquired');
    const r = await checkProviderOrchestrationGate({
      ...baseParams,
      source: 'webhook',
      appCache: makeAppCache(),
    });
    expect(r.allowed).toBe(true);
    expect(r.lockToken).toBeTruthy();
    expect(r.identity).toEqual({ kind: 'ghl_message_id', value: 'ghl-msg-1' });
  });
});

describe('markProviderOrchestrationDone', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
  });

  it('sets done marker in Redis for ghl_message_id identity', async () => {
    await markProviderOrchestrationDone(makeAppCache(), 't1', { kind: 'ghl_message_id', value: 'ghl-msg-1' });
    expect(mockRedisSet).toHaveBeenCalledWith(
      'done:orch-provider:t1:ghl-msg-1',
      '1',
      'EX',
      86_400,
    );
  });

  it('sets done marker in Redis for kb_fallback identity', async () => {
    await markProviderOrchestrationDone(makeAppCache(), 't1', { kind: 'kb_fallback', value: 'kb-msg-1' });
    expect(mockRedisSet).toHaveBeenCalledWith(
      'done:orch-provider-fallback:t1:kb-msg-1',
      '1',
      'EX',
      86_400,
    );
  });

  it('no-ops without identity', async () => {
    await markProviderOrchestrationDone(makeAppCache(), 't1', null);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('no-ops without appCache', async () => {
    await markProviderOrchestrationDone(undefined, 't1', { kind: 'ghl_message_id', value: 'ghl-msg-1' });
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('no-ops on Redis error', async () => {
    mockRedisSet.mockRejectedValue(new Error('Redis down'));
    await markProviderOrchestrationDone(makeAppCache(), 't1', { kind: 'ghl_message_id', value: 'ghl-msg-1' });
    // should not throw
  });
});

describe('releaseProviderLock', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockReleaseLock.mockResolvedValue(true);
  });

  it('releases ghl lock with matching token', async () => {
    await releaseProviderLock(makeAppCache(), 't1', { kind: 'ghl_message_id', value: 'ghl-msg-1' }, 'token-1');
    expect(mockReleaseLock).toHaveBeenCalledWith(
      'lock:orch-provider:t1:ghl-msg-1',
      'token-1',
    );
  });

  it('releases fallback lock with matching token', async () => {
    await releaseProviderLock(makeAppCache(), 't1', { kind: 'kb_fallback', value: 'kb-msg-1' }, 'token-1');
    expect(mockReleaseLock).toHaveBeenCalledWith(
      'lock:orch-provider-fallback:t1:kb-msg-1',
      'token-1',
    );
  });

  it('no-ops without lockToken', async () => {
    await releaseProviderLock(makeAppCache(), 't1', { kind: 'ghl_message_id', value: 'ghl-msg-1' }, undefined);
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  it('no-ops without identity', async () => {
    await releaseProviderLock(makeAppCache(), 't1', null, 'token-1');
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });
});
