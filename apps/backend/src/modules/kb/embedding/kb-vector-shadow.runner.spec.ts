import {
  kbVectorShadowEnabledForTenant,
  runKbVectorShadow,
  type KbVectorShadowDeps,
} from './kb-vector-shadow.runner';

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

async function withEnvAsync(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/** Supabase stub: tenant->agency->OPENAI provider + match_knowledge_chunks rpc. */
function makeSupabaseStub(opts: {  hasKey?: boolean;
  rpcRows?: unknown[];
  rpcError?: unknown;
}): KbVectorShadowDeps['supabase'] {
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
              data: opts.hasKey === false ? null : { api_key: 'sk-live-realkey', endpoint: null },
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
  return stub as unknown as KbVectorShadowDeps['supabase'];
}

const embeddingFactory = () => ({
  embedTexts: async (texts: string[]) => texts.map(() => ({ embedding: new Array(1536).fill(0.01) })),
});

const silentLogger = { log: () => undefined, warn: () => undefined };

describe('kbVectorShadowEnabledForTenant (fail-closed flag)', () => {
  it('is OFF by default (flag unset)', () => {
    withEnv({ KB_VECTOR_SHADOW_ENABLED: undefined, KB_VECTOR_SHADOW_TENANT_IDS: undefined }, () => {
      expect(kbVectorShadowEnabledForTenant(TENANT)).toBe(false);
    });
  });

  it('is OFF when flag true but tenant list empty (fail-closed)', () => {
    withEnv({ KB_VECTOR_SHADOW_ENABLED: 'true', KB_VECTOR_SHADOW_TENANT_IDS: '' }, () => {
      expect(kbVectorShadowEnabledForTenant(TENANT)).toBe(false);
    });
  });

  it('is OFF when tenant not in the allowlist', () => {
    withEnv({ KB_VECTOR_SHADOW_ENABLED: 'true', KB_VECTOR_SHADOW_TENANT_IDS: 'other-tenant' }, () => {
      expect(kbVectorShadowEnabledForTenant(TENANT)).toBe(false);
    });
  });

  it('is OFF when flag is not exactly true', () => {
    withEnv({ KB_VECTOR_SHADOW_ENABLED: '1', KB_VECTOR_SHADOW_TENANT_IDS: TENANT }, () => {
      expect(kbVectorShadowEnabledForTenant(TENANT)).toBe(false);
    });
  });

  it('is ON only when flag true AND tenant listed (case-insensitive true)', () => {
    withEnv({ KB_VECTOR_SHADOW_ENABLED: 'TRUE', KB_VECTOR_SHADOW_TENANT_IDS: `a,${TENANT}, b` }, () => {
      expect(kbVectorShadowEnabledForTenant(TENANT)).toBe(true);
    });
  });
});

describe('runKbVectorShadow (log-only, never throws)', () => {
  it('returns candidates on the happy path and logs safely (truncated preview, hashed)', async () => {
    const logs: string[] = [];
    const longContent =
      'Basic plan is $29 per month billed annually plus a very long trailing description that clearly exceeds sixty characters so we can prove truncation.';
    const out = await runKbVectorShadow(
      { tenantId: TENANT, conversationId: 'c1', query: 'What are your prices?' },
      {
        supabase: makeSupabaseStub({
          rpcRows: [
            { chunk_id: 'ch1', document_id: 'd1', title: 'Pricing', source: 'manual', content: longContent, metadata: {}, document_updated_at: null, vector_score: 0.42 },
            { chunk_id: 'ch2', document_id: 'd1', title: 'Pricing', source: 'manual', content: 'Pro $79', metadata: {}, document_updated_at: null, vector_score: 0.26 },
          ],
        }),
        embeddingClientFactory: embeddingFactory,
        logger: { log: (m) => logs.push(m), warn: (m) => logs.push(m) },
      },
    );
    expect(out).toEqual({ ok: true, count: 2, topChunkIds: ['ch1', 'ch2'] });
    const joined = logs.join('\n');
    expect(joined).toContain('kb_vector_shadow');
    expect(joined).toContain('shadow_no_reply_impact');
    expect(joined).toContain('hash');
    // Full raw chunk content is never dumped — only a bounded (<=60 char) head.
    expect(joined).not.toContain(longContent);
    expect(joined).not.toContain('prove truncation');
  });

  it('never leaks content head in production logs (only length + hash)', async () => {
    await withEnvAsync({ NODE_ENV: 'production' }, async () => {
      const logs: string[] = [];
      await runKbVectorShadow(
        { tenantId: TENANT, conversationId: 'c1', query: 'What are your prices?' },
        {
          supabase: makeSupabaseStub({
            rpcRows: [
              { chunk_id: 'ch1', document_id: 'd1', title: 'Pricing', source: 'manual', content: 'Basic $29 monthly', metadata: {}, document_updated_at: null, vector_score: 0.42 },
            ],
          }),
          embeddingClientFactory: embeddingFactory,
          logger: { log: (m) => logs.push(m), warn: (m) => logs.push(m) },
        },
      );
      const joined = logs.join('\n');
      expect(joined).toContain('hash');
      expect(joined).not.toContain('Basic $29 monthly');
      expect(joined).not.toContain('What are your prices?');
    });
  });


  it('returns ok:false (no throw) when no usable OpenAI key', async () => {
    const out = await runKbVectorShadow(
      { tenantId: TENANT, query: 'q' },
      { supabase: makeSupabaseStub({ hasKey: false }), embeddingClientFactory: embeddingFactory, logger: silentLogger },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('no_openai_key');
  });

  it('returns ok:false (no throw) on RPC error', async () => {
    const out = await runKbVectorShadow(
      { tenantId: TENANT, query: 'q' },
      { supabase: makeSupabaseStub({ rpcError: { message: 'boom' } }), embeddingClientFactory: embeddingFactory, logger: silentLogger },
    );
    expect(out).toEqual({ ok: false, reason: 'rpc_error' });
  });

  it('never throws even if the embedding client throws', async () => {
    const out = await runKbVectorShadow(
      { tenantId: TENANT, query: 'q' },
      {
        supabase: makeSupabaseStub({ rpcRows: [] }),
        embeddingClientFactory: () => ({ embedTexts: async () => { throw new Error('network'); } }),
        logger: silentLogger,
      },
    );
    expect(out).toEqual({ ok: false, reason: 'exception' });
  });

  it('short-circuits empty allowlist without RPC error', async () => {
    const out = await runKbVectorShadow(
      { tenantId: TENANT, query: 'q', documentIdAllowlist: [] },
      { supabase: makeSupabaseStub({ rpcRows: [] }), embeddingClientFactory: embeddingFactory, logger: silentLogger },
    );
    expect(out).toEqual({ ok: true, count: 0, topChunkIds: [] });
  });
});
