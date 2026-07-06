import {
  parseEvalArgs,
  resolveStagingEnvGuard,
  shapeQueryEvalReport,
  mergeTenantIntoAllowlist,
  SAFE_DEFAULT_TENANT,
  DEFAULT_SAFE_QUERIES,
  DEFAULT_TOP_K,
  type KeywordComparison,
} from './kb-rag-eval';
import type { KbVectorContextOutcome } from './kb-vector-context.runner';
import type { RetrievalResult } from '../dto/retrieval.dto';

describe('resolveStagingEnvGuard', () => {
  it('refuses production-like envs', () => {
    expect(resolveStagingEnvGuard({ NODE_ENV: 'production' })).toEqual({
      ok: false,
      reason: 'production_like_env_refused',
    });
    expect(resolveStagingEnvGuard({ RAILWAY_ENVIRONMENT: 'prod', APP_ENV: 'staging' })).toEqual({
      ok: false,
      reason: 'production_like_env_refused',
    });
  });

  it('requires a staging-like signal', () => {
    expect(resolveStagingEnvGuard({ NODE_ENV: 'test' })).toEqual({
      ok: false,
      reason: 'staging_env_required',
    });
    expect(resolveStagingEnvGuard({})).toEqual({ ok: false, reason: 'staging_env_required' });
  });

  it('accepts staging/stage tokens', () => {
    expect(resolveStagingEnvGuard({ NODE_ENV: 'staging' })).toEqual({ ok: true, matched: ['staging'] });
    expect(resolveStagingEnvGuard({ VERCEL_ENV: 'stage' })).toEqual({ ok: true, matched: ['stage'] });
  });
});

describe('parseEvalArgs', () => {
  it('requires --tenant', () => {
    expect(() => parseEvalArgs(['--query', 'hi'])).toThrow(/Missing required --tenant/);
  });

  it('collects repeated --query and options', () => {
    const opts = parseEvalArgs([
      '--tenant', 't1',
      '--query', 'a',
      '--query', 'b',
      '--document-ids', 'd1, d2 ,',
      '--limit', '8',
      '--min-score', '0.35',
      '--json',
    ]);
    expect(opts.tenantId).toBe('t1');
    expect(opts.queries).toEqual(['a', 'b']);
    expect(opts.documentIdAllowlist).toEqual(['d1', 'd2']);
    expect(opts.topK).toBe(8);
    expect(opts.minScore).toBe(0.35);
    expect(opts.json).toBe(true);
    expect(opts.killSwitchCheck).toBe(false);
  });

  it('uses the built-in safe question set only for the staging test tenant', () => {
    const opts = parseEvalArgs(['--tenant', SAFE_DEFAULT_TENANT]);
    expect(opts.queries).toEqual([...DEFAULT_SAFE_QUERIES]);
    expect(opts.topK).toBe(DEFAULT_TOP_K);
  });

  it('refuses default queries for other tenants', () => {
    expect(() => parseEvalArgs(['--tenant', 'other'])).toThrow(/only available for tenant/);
  });

  it('clamps min-score to [0,1] and rejects unknown args', () => {
    expect(parseEvalArgs(['--tenant', 't1', '--query', 'q', '--min-score', '5']).minScore).toBe(1);
    expect(() => parseEvalArgs(['--tenant', 't1', '--query', 'q', '--boom'])).toThrow(/Unknown argument/);
  });

  it('rejects missing flag values instead of treating another flag as text', () => {
    expect(() => parseEvalArgs(['--tenant', 't1', '--query', '--json'])).toThrow(/Missing value for --query/);
    expect(() => parseEvalArgs(['--tenant', '--query', 'q'])).toThrow(/Missing value for --tenant/);
    expect(() => parseEvalArgs(['--tenant', 't1', '--query', 'q', '--limit', 'nope'])).toThrow(/Invalid --limit/);
    expect(() => parseEvalArgs(['--tenant', 't1', '--query', 'q', '--min-score', 'nope'])).toThrow(/Invalid --min-score/);
  });

  it('parses kill-switch check mode', () => {
    expect(parseEvalArgs(['--tenant', SAFE_DEFAULT_TENANT, '--check']).killSwitchCheck).toBe(true);
    expect(parseEvalArgs(['--tenant', SAFE_DEFAULT_TENANT, '--kill-switch-check']).killSwitchCheck).toBe(true);
  });
});

describe('mergeTenantIntoAllowlist', () => {
  it('adds a tenant without duplicating', () => {
    expect(mergeTenantIntoAllowlist('a, b', 'c')).toBe('a,b,c');
    expect(mergeTenantIntoAllowlist('a,b', 'b')).toBe('a,b');
    expect(mergeTenantIntoAllowlist(undefined, 't')).toBe('t');
  });
});

describe('shapeQueryEvalReport', () => {
  const vectorResult: RetrievalResult = {
    query: 'q',
    chunks: [
      { chunkId: 'ch1', documentId: 'd1', content: 'SECRET RAW BODY', title: 'T', source: 'manual', relevanceScore: 0.42, metadata: {} },
      { chunkId: 'ch2', documentId: 'd2', content: 'MORE RAW BODY', title: 'T', source: 'manual', relevanceScore: 0.31, metadata: {} },
    ],
    totalConsidered: 9,
    retrievalMode: 'vector',
  };
  const keyword: KeywordComparison = {
    retrievalMode: 'keyword',
    totalConsidered: 20,
    chunks: [
      { chunkId: 'ch1', documentId: 'd1', relevanceScore: 0.8 },
      { chunkId: 'ch9', documentId: 'd9', relevanceScore: 0.5 },
    ],
  };

  it('reports vector would enter prompt when enabled and ok, with overlap', () => {
    const okOutcome: KbVectorContextOutcome = { ok: true, result: vectorResult, topChunkIds: ['ch1', 'ch2'] };
    const report = shapeQueryEvalReport({
      query: 'What are your prices?',
      vectorEnabledForTenant: true,
      vectorOutcome: okOutcome,
      keyword,
      minScore: 0.2,
    });

    expect(report.wouldEnterPrompt).toBe(true);
    expect(report.vectorFallbackReason).toBeNull();
    expect(report.vector.ok).toBe(true);
    if (report.vector.ok) {
      expect(report.vector.chunkIds).toEqual(['ch1', 'ch2']);
      expect(report.vector.documentIds).toEqual(['d1', 'd2']);
    }
    expect(report.keyword?.chunkIds).toEqual(['ch1', 'ch9']);
    expect(report.overlap).toEqual({ chunkIds: ['ch1'], count: 1 });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('RAW BODY');
    expect(serialized).not.toContain('SECRET');
  });

  it('reports fallback reason and no prompt entry when disabled/failed', () => {
    const failOutcome: KbVectorContextOutcome = { ok: false, reason: 'kill_switch_disabled' };
    const report = shapeQueryEvalReport({
      query: 'q',
      vectorEnabledForTenant: false,
      vectorOutcome: failOutcome,
      keyword,
      minScore: null,
    });

    expect(report.wouldEnterPrompt).toBe(false);
    expect(report.vectorFallbackReason).toBe('kill_switch_disabled');
    expect(report.vector.ok).toBe(false);
    expect(report.retrievalMode).toBe('keyword');
    expect(report.overlap.count).toBe(0);
  });
});
