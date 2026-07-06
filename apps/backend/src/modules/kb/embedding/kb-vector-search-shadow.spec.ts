import {
  vectorSearchShadow,
  type VectorSearchShadowCandidate,
} from './kb-vector-search-shadow';
import type { SupabaseRpcLikeClient } from './kb-embedding-store';

function embedding(dimensions = 1536): number[] {
  return Array.from({ length: dimensions }, (_, index) => index / dimensions);
}

function makeSupabaseStub(data: unknown, error: unknown = null): SupabaseRpcLikeClient & {
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return { data, error };
    },
  };
}

function row(overrides?: Partial<VectorSearchShadowCandidate>): Record<string, unknown> {
  return {
    chunk_id: overrides?.chunkId ?? 'chunk-1',
    document_id: overrides?.documentId ?? 'doc-1',
    title: overrides?.title ?? 'Doc',
    source: overrides?.source ?? 'vault',
    content: overrides?.content ?? 'content',
    metadata: overrides?.metadata ?? { embedding: [1, 2, 3] },
    document_updated_at: overrides?.documentUpdatedAt ?? '2026-07-06T00:00:00Z',
    vector_score: overrides?.vectorScore ?? 0.92,
  };
}

describe('kb-vector-search-shadow', () => {
  it('short-circuits an empty allowlist without calling RPC', async () => {
    const supabase = makeSupabaseStub([]);

    const result = await vectorSearchShadow(supabase, {
      tenantId: 'tenant-1',
      queryEmbedding: embedding(),
      documentIdAllowlist: [],
    });

    expect(result).toEqual({ ok: true, candidates: [], skipped: 'empty_allowlist' });
    expect(supabase.calls).toHaveLength(0);
  });

  it('calls match_knowledge_chunks with tenant, vector text, allowlist, and clamped limit', async () => {
    const supabase = makeSupabaseStub([row()]);

    const result = await vectorSearchShadow(supabase, {
      tenantId: 'tenant-1',
      queryEmbedding: embedding(),
      documentIdAllowlist: ['doc-1'],
      limit: 999,
    });

    expect(result.ok).toBe(true);
    expect(supabase.calls).toHaveLength(1);
    expect(supabase.calls[0].fn).toBe('match_knowledge_chunks');
    expect(supabase.calls[0].args).toMatchObject({
      p_tenant_id: 'tenant-1',
      p_document_id_allowlist: ['doc-1'],
      p_limit: 50,
    });
    expect(String(supabase.calls[0].args['p_query_embedding']).startsWith('[')).toBe(true);
  });

  it('passes null allowlist when none is provided', async () => {
    const supabase = makeSupabaseStub([]);

    await vectorSearchShadow(supabase, {
      tenantId: 'tenant-1',
      queryEmbedding: embedding(),
    });

    expect(supabase.calls[0].args['p_document_id_allowlist']).toBeNull();
  });

  it('returns invalid_embedding without calling RPC for wrong dimensions', async () => {
    const supabase = makeSupabaseStub([]);

    const result = await vectorSearchShadow(supabase, {
      tenantId: 'tenant-1',
      queryEmbedding: embedding(3),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_embedding');
    }
    expect(supabase.calls).toHaveLength(0);
  });

  it('returns rpc_error when match RPC fails', async () => {
    const supabase = makeSupabaseStub(null, { message: 'permission denied' });

    const result = await vectorSearchShadow(supabase, {
      tenantId: 'tenant-1',
      queryEmbedding: embedding(),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'rpc_error',
      message: 'permission denied',
    });
  });

  it('maps candidates without using legacy metadata.embedding for scoring', async () => {
    const supabase = makeSupabaseStub([
      row({ metadata: { embedding: [9, 9, 9], sectionTitle: 'FAQ' }, vectorScore: 0.77 }),
    ]);

    const result = await vectorSearchShadow(supabase, {
      tenantId: 'tenant-1',
      queryEmbedding: embedding(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates[0]).toMatchObject({
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        vectorScore: 0.77,
        metadata: { embedding: [9, 9, 9], sectionTitle: 'FAQ' },
      });
    }
  });

  it('rejects non-array RPC data', async () => {
    const supabase = makeSupabaseStub({ nope: true });

    const result = await vectorSearchShadow(supabase, {
      tenantId: 'tenant-1',
      queryEmbedding: embedding(),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_response',
      message: 'match_knowledge_chunks returned non-array data',
    });
  });

  it('rejects malformed rows', async () => {
    const supabase = makeSupabaseStub([{ chunk_id: 'chunk-1' }]);

    const result = await vectorSearchShadow(supabase, {
      tenantId: 'tenant-1',
      queryEmbedding: embedding(),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_response',
      message: 'match_knowledge_chunks returned malformed row',
    });
  });
});
