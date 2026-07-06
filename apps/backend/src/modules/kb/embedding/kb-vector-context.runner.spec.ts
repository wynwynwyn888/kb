import {
  kbVectorContextEnabledForTenant,
  runKbVectorContext,
  type KbVectorContextDeps,
} from './kb-vector-context.runner';

const TENANT = 'stg-rag-tenant';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function makeSupabaseStub(opts: {
  hasKey?: boolean;
  rpcRows?: unknown[];
  rpcError?: unknown;
}): KbVectorContextDeps['supabase'] {
  const stub = {
    from(table: string) {
      const builder = {
        eq() {
          return builder;
        },
        async maybeSingle() {
          if (table === 'tenants') return { data: { agency_id: 'ag-1' }, error: null };
          if (table === 'agency_model_providers') {
            return {
              data: opts.hasKey === false ? null : { api_key: 'test-openai-key', endpoint: null },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return { select: () => builder };
    },
    async rpc(_fn: string, _args: unknown) {
      return { data: opts.rpcError ? null : (opts.rpcRows ?? []), error: opts.rpcError ?? null };
    },
  };
  return stub as unknown as KbVectorContextDeps['supabase'];
}

const embeddingFactory = () => ({
  embedTexts: async (texts: string[]) => texts.map(() => ({ embedding: new Array(1536).fill(0.01) })),
});

const silentLogger = { log: () => undefined, warn: () => undefined };

describe('kbVectorContextEnabledForTenant', () => {
  it('is OFF by default', () => {
    withEnv(
      { NODE_ENV: 'staging', KB_VECTOR_CONTEXT_ENABLED: undefined, KB_VECTOR_CONTEXT_TENANT_IDS: undefined },
      () => expect(kbVectorContextEnabledForTenant(TENANT)).toBe(false),
    );
  });

  it('is OFF outside staging even when flags are true', () => {
    withEnv(
      { NODE_ENV: 'production', KB_VECTOR_CONTEXT_ENABLED: 'true', KB_VECTOR_CONTEXT_TENANT_IDS: TENANT },
      () => expect(kbVectorContextEnabledForTenant(TENANT)).toBe(false),
    );
  });

  it('is OFF when tenant allowlist is empty', () => {
    withEnv(
      { NODE_ENV: 'staging', KB_VECTOR_CONTEXT_ENABLED: 'true', KB_VECTOR_CONTEXT_TENANT_IDS: '' },
      () => expect(kbVectorContextEnabledForTenant(TENANT)).toBe(false),
    );
  });

  it('is ON only in staging when flag and allowlist match', () => {
    withEnv(
      { NODE_ENV: 'staging', KB_VECTOR_CONTEXT_ENABLED: 'true', KB_VECTOR_CONTEXT_TENANT_IDS: `other,${TENANT}` },
      () => expect(kbVectorContextEnabledForTenant(TENANT)).toBe(true),
    );
  });
});

describe('runKbVectorContext', () => {
  it('returns vector RetrievalResult for strong candidates', async () => {
    const out = await runKbVectorContext(
      { tenantId: TENANT, conversationId: 'c1', query: 'What are your prices?', topK: 5 },
      {
        supabase: makeSupabaseStub({
          rpcRows: [
            { chunk_id: 'ch1', document_id: 'd1', title: 'Pricing', source: 'manual', content: 'Basic $29', metadata: {}, document_updated_at: null, vector_score: 0.42 },
            { chunk_id: 'ch2', document_id: 'd1', title: 'Pricing', source: 'manual', content: 'Pro $79', metadata: {}, document_updated_at: null, vector_score: 0.26 },
          ],
        }),
        embeddingClientFactory: embeddingFactory,
        logger: silentLogger,
      },
    );

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.retrievalMode).toBe('vector');
      expect(out.result.chunks.map((c) => c.chunkId)).toEqual(['ch1', 'ch2']);
      expect(out.result.chunks[0].metadata['retrievalSource']).toBe('rag_vector_context');
    }
  });

  it('falls back when candidates are weak', async () => {
    const out = await runKbVectorContext(
      { tenantId: TENANT, query: 'q' },
      {
        supabase: makeSupabaseStub({
          rpcRows: [
            { chunk_id: 'ch1', document_id: 'd1', title: 'Doc', source: 'manual', content: 'weak', metadata: {}, document_updated_at: null, vector_score: 0.01 },
          ],
        }),
        embeddingClientFactory: embeddingFactory,
        logger: silentLogger,
      },
    );

    expect(out).toEqual({ ok: false, reason: 'weak_or_empty_vector_candidates' });
  });

  it('falls back when credentials are unavailable', async () => {
    const out = await runKbVectorContext(
      { tenantId: TENANT, query: 'q' },
      {
        supabase: makeSupabaseStub({ hasKey: false }),
        embeddingClientFactory: embeddingFactory,
        logger: silentLogger,
      },
    );

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('no_openai_key');
  });

  it('never throws when embedding client throws', async () => {
    const out = await runKbVectorContext(
      { tenantId: TENANT, query: 'q' },
      {
        supabase: makeSupabaseStub({ rpcRows: [] }),
        embeddingClientFactory: () => ({ embedTexts: async () => { throw new Error('network'); } }),
        logger: silentLogger,
      },
    );

    expect(out).toEqual({ ok: false, reason: 'exception' });
  });
});
