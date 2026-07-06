import { jest as jestGlobal } from '@jest/globals';

import { KbIngestProcessor } from './kb-ingest.processor';
import { runKbEmbeddingBackfill } from '../../modules/kb/embedding/kb-embedding-backfill';

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({ rpc: jestGlobal.fn() }),
}));

jestGlobal.mock('../../modules/kb/embedding/kb-embedding-backfill', () => ({
  runKbEmbeddingBackfill: jestGlobal.fn(async () => ({
    ok: true,
    tenantId: 'tenant-1',
    scanned: 1,
    embedded: 1,
    failed: 0,
    skipped: 0,
    approximateTokens: 10,
  })),
}));

const backfillMock = runKbEmbeddingBackfill as jestGlobal.MockedFunction<typeof runKbEmbeddingBackfill>;

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return fn().finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

describe('KbIngestProcessor', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
  });

  it('skips embedding maintenance when the staging flag is off', async () => {
    const processor = new KbIngestProcessor();

    await withEnv(
      { NODE_ENV: 'staging', KB_EMBEDDING_JOBS_ENABLED: undefined, KB_EMBEDDING_JOB_TENANT_IDS: undefined },
      async () => {
        await processor.process({ id: 'job-1', data: { tenantId: 'tenant-1', documentId: 'doc-1' } } as never);
      },
    );

    expect(backfillMock).not.toHaveBeenCalled();
  });

  it('runs document-scoped embedding backfill for allowlisted staging tenants', async () => {
    const processor = new KbIngestProcessor();

    await withEnv(
      { NODE_ENV: 'staging', KB_EMBEDDING_JOBS_ENABLED: 'true', KB_EMBEDDING_JOB_TENANT_IDS: 'tenant-1' },
      async () => {
        await processor.process({
          id: 'job-1',
          data: { tenantId: 'tenant-1', documentId: 'doc-1', reason: 'update' },
        } as never);
      },
    );

    expect(backfillMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      documentId: 'doc-1',
      statuses: ['pending', 'failed'],
      limit: 500,
      batchSize: 32,
      delayMs: 0,
    });
  });
});
