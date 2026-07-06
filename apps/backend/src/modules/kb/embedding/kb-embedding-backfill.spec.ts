import {
  runKbEmbeddingBackfill,
  type BackfillSupabaseClient,
} from './kb-embedding-backfill';

function embedding(): number[] {
  return Array.from({ length: 1536 }, (_, index) => index / 1536);
}

class QueryStub implements PromiseLike<{ data: unknown; error: unknown }> {
  readonly filters: Array<{ op: string; column: string; value: unknown }> = [];

  constructor(
    private readonly result: { data: unknown; error: unknown },
    private readonly singleResult?: { data: unknown; error: unknown },
  ) {}

  eq(column: string, value: unknown): QueryStub {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  in(column: string, value: unknown[]): QueryStub {
    this.filters.push({ op: 'in', column, value });
    return this;
  }

  is(column: string, value: unknown): QueryStub {
    this.filters.push({ op: 'is', column, value });
    return this;
  }

  limit(count: number): QueryStub {
    this.filters.push({ op: 'limit', column: 'limit', value: count });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): QueryStub {
    this.filters.push({ op: 'order', column, value: options ?? {} });
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    return Promise.resolve(this.singleResult ?? this.result);
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function makeSupabaseStub(options?: {
  pgvector?: boolean;
  docs?: unknown[];
  chunks?: unknown[];
  tenant?: unknown;
  provider?: unknown;
  rpcError?: unknown;
}): BackfillSupabaseClient & {
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  queries: Array<{ table: string; columns: string; query: QueryStub }>;
} {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const queries: Array<{ table: string; columns: string; query: QueryStub }> = [];
  return {
    rpcCalls,
    queries,
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (options?.rpcError) return { data: null, error: options.rpcError };
      if (fn === 'check_pgvector_available') {
        return { data: options?.pgvector ?? true, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      return {
        select(columns: string) {
          let result: { data: unknown; error: unknown } = { data: [], error: null };
          let singleResult: { data: unknown; error: unknown } | undefined;
          if (table === 'knowledge_documents') {
            result = { data: options?.docs ?? [], error: null };
          } else if (table === 'knowledge_chunks') {
            result = { data: options?.chunks ?? [], error: null };
          } else if (table === 'tenants') {
            singleResult = { data: options?.tenant ?? null, error: null };
          } else if (table === 'agency_model_providers') {
            singleResult = { data: options?.provider ?? null, error: null };
          }
          const query = new QueryStub(result, singleResult);
          queries.push({ table, columns, query });
          return query;
        },
      };
    },
  };
}

describe('kb-embedding-backfill', () => {
  it('dry-runs tenant-limited ready chunks without resolving credentials', async () => {
    const supabase = makeSupabaseStub({
      docs: [{ id: 'doc-1' }],
      chunks: [{ id: 'chunk-1', content: 'hello' }],
    });

    const summary = await runKbEmbeddingBackfill(supabase, {
      tenantId: 'tenant-1',
      dryRun: true,
    });

    expect(summary).toMatchObject({
      ok: true,
      scanned: 1,
      skipped: 1,
      embedded: 0,
      failed: 0,
    });
    expect(supabase.queries.map((q) => q.table)).toEqual([
      'knowledge_documents',
      'knowledge_chunks',
    ]);
  });

  it('fails closed when pgvector is unavailable', async () => {
    const supabase = makeSupabaseStub({ pgvector: false });

    const summary = await runKbEmbeddingBackfill(supabase, { tenantId: 'tenant-1' });

    expect(summary).toMatchObject({
      ok: false,
      reason: 'pgvector unavailable',
      scanned: 0,
    });
  });

  it('loads only READY tenant docs and requested chunk statuses', async () => {
    const supabase = makeSupabaseStub({
      docs: [{ id: 'doc-1' }],
      chunks: [],
    });

    await runKbEmbeddingBackfill(supabase, {
      tenantId: 'tenant-1',
      statuses: ['failed', 'skipped'],
      dryRun: true,
      limit: 25,
    });

    const docsQuery = supabase.queries.find((q) => q.table === 'knowledge_documents')?.query;
    const chunksQuery = supabase.queries.find((q) => q.table === 'knowledge_chunks')?.query;
    expect(docsQuery?.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'tenant_id', value: 'tenant-1' },
        { op: 'eq', column: 'status', value: 'READY' },
      ]),
    );
    expect(chunksQuery?.filters).toEqual(
      expect.arrayContaining([
        { op: 'in', column: 'embedding_status', value: ['failed', 'skipped'] },
        { op: 'is', column: 'embedding', value: null },
        { op: 'limit', column: 'limit', value: 25 },
      ]),
    );
  });

  it('can scope embedding work to one document', async () => {
    const supabase = makeSupabaseStub({
      docs: [{ id: 'doc-1' }],
      chunks: [{ id: 'chunk-1', content: 'hello' }],
    });

    await runKbEmbeddingBackfill(supabase, {
      tenantId: 'tenant-1',
      documentId: 'doc-1',
      dryRun: true,
    });

    const docsQuery = supabase.queries.find((q) => q.table === 'knowledge_documents')?.query;
    expect(docsQuery?.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'tenant_id', value: 'tenant-1' },
        { op: 'eq', column: 'status', value: 'READY' },
        { op: 'eq', column: 'id', value: 'doc-1' },
      ]),
    );
  });

  it('embeds prepared inputs and stores successful embeddings', async () => {
    const supabase = makeSupabaseStub({
      docs: [{ id: 'doc-1' }],
      chunks: [{ id: 'chunk-1', content: 'x'.repeat(9000) }],
      tenant: { agency_id: 'agency-1' },
      provider: { api_key: 'sk-live-realkey', endpoint: 'https://proxy.example/v1' },
    });
    const stored: unknown[] = [];
    const embeddedInputs: string[][] = [];

    const summary = await runKbEmbeddingBackfill(
      supabase,
      { tenantId: 'tenant-1', batchSize: 10 },
      {
        createEmbeddingClient: () => ({
          async embedTexts(texts: string[]) {
            embeddedInputs.push(texts);
            return texts.map((_, index) => ({ index, embedding: embedding() }));
          },
        }),
        async storeEmbedding(_client, params) {
          stored.push(params);
          return { ok: true, status: 'accepted' };
        },
      },
    );

    expect(summary.ok).toBe(true);
    expect(summary.embedded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(embeddedInputs[0][0]).toHaveLength(8000);
    expect(stored[0]).toMatchObject({
      chunkId: 'chunk-1',
      embeddingModel: 'text-embedding-3-small',
    });
    expect(String((stored[0] as { embeddingInputHash: string }).embeddingInputHash)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('fails closed when tenant has no usable OpenAI credentials', async () => {
    const supabase = makeSupabaseStub({
      docs: [{ id: 'doc-1' }],
      chunks: [{ id: 'chunk-1', content: 'hello' }],
      tenant: { agency_id: 'agency-1' },
      provider: { api_key: 'sk-test-placeholder' },
    });

    const summary = await runKbEmbeddingBackfill(supabase, { tenantId: 'tenant-1' });

    expect(summary).toMatchObject({
      ok: false,
      reason: 'unusable_key',
      scanned: 1,
      embedded: 0,
      failed: 0,
    });
  });

  it('marks each chunk failed when embedding generation throws', async () => {
    const supabase = makeSupabaseStub({
      docs: [{ id: 'doc-1' }],
      chunks: [
        { id: 'chunk-1', content: 'hello' },
        { id: 'chunk-2', content: 'world' },
      ],
      tenant: { agency_id: 'agency-1' },
      provider: { api_key: 'sk-live-realkey' },
    });
    const failed: unknown[] = [];

    const summary = await runKbEmbeddingBackfill(
      supabase,
      { tenantId: 'tenant-1', batchSize: 2 },
      {
        createEmbeddingClient: () => ({
          async embedTexts() {
            throw new Error('OpenAI API responded with status 500');
          },
        }),
        async markFailed(_client, params) {
          failed.push(params);
          return { ok: true, status: 'accepted' };
        },
      },
    );

    expect(summary).toMatchObject({ ok: true, embedded: 0, failed: 2 });
    expect(failed).toHaveLength(2);
    expect(failed[0]).toMatchObject({ chunkId: 'chunk-1' });
    expect(failed[1]).toMatchObject({ chunkId: 'chunk-2' });
  });
});
