import {
  markKnowledgeChunkEmbeddingFailed,
  sanitizeEmbeddingFailureReason,
  storeKnowledgeChunkEmbedding,
  type SupabaseRpcLikeClient,
} from './kb-embedding-store';

function embedding(dimensions = 1536): number[] {
  return Array.from({ length: dimensions }, (_, index) => index / dimensions);
}

function makeSupabaseStub(
  responses: Array<{ data?: unknown; error?: unknown }> = [{ data: null, error: null }],
): SupabaseRpcLikeClient & {
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const next = responses.shift() ?? { data: null, error: null };
      return { data: next.data ?? null, error: next.error ?? null };
    },
  };
}

describe('kb-embedding-store', () => {
  describe('storeKnowledgeChunkEmbedding', () => {
    it('stores a valid embedding via set_knowledge_chunk_embedding', async () => {
      const supabase = makeSupabaseStub();

      const result = await storeKnowledgeChunkEmbedding(supabase, {
        chunkId: 'chunk-1',
        embedding: embedding(),
        embeddingModel: 'text-embedding-3-small',
        embeddingInputHash: 'hash-1',
      });

      expect(result).toEqual({ ok: true, status: 'accepted' });
      expect(supabase.calls).toHaveLength(1);
      expect(supabase.calls[0].fn).toBe('set_knowledge_chunk_embedding');
      expect(supabase.calls[0].args).toMatchObject({
        p_chunk_id: 'chunk-1',
        p_embedding_model: 'text-embedding-3-small',
        p_embedding_input_hash: 'hash-1',
      });
      expect(String(supabase.calls[0].args['p_embedding']).startsWith('[')).toBe(true);
      expect(String(supabase.calls[0].args['p_embedding']).endsWith(']')).toBe(true);
    });

    it('returns invalid_embedding without calling RPC for wrong dimensions', async () => {
      const supabase = makeSupabaseStub();

      const result = await storeKnowledgeChunkEmbedding(supabase, {
        chunkId: 'chunk-1',
        embedding: embedding(3),
        embeddingModel: 'text-embedding-3-small',
        embeddingInputHash: 'hash-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('invalid_embedding');
        expect(result.message).toContain('expected 1536 dimensions');
      }
      expect(supabase.calls).toHaveLength(0);
    });

    it('returns rpc_error when the success RPC fails', async () => {
      const supabase = makeSupabaseStub([
        { error: { message: 'permission denied for function set_knowledge_chunk_embedding' } },
      ]);

      const result = await storeKnowledgeChunkEmbedding(supabase, {
        chunkId: 'chunk-1',
        embedding: embedding(),
        embeddingModel: 'text-embedding-3-small',
        embeddingInputHash: 'hash-1',
      });

      expect(result).toEqual({
        ok: false,
        reason: 'rpc_error',
        message: 'permission denied for function set_knowledge_chunk_embedding',
      });
    });

    it('does not leak vector values through invalid embedding errors', async () => {
      const supabase = makeSupabaseStub();
      const result = await storeKnowledgeChunkEmbedding(supabase, {
        chunkId: 'chunk-1',
        embedding: [0.123456789, Number.NaN],
        embeddingModel: 'text-embedding-3-small',
        embeddingInputHash: 'hash-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).not.toContain('0.123456789');
      }
    });
  });

  describe('markKnowledgeChunkEmbeddingFailed', () => {
    it('marks a chunk failed with sanitized error and stale-hash guard', async () => {
      const supabase = makeSupabaseStub();

      const result = await markKnowledgeChunkEmbeddingFailed(supabase, {
        chunkId: 'chunk-1',
        error: new Error('OpenAI API responded with status 429'),
        embeddingInputHash: 'hash-1',
      });

      expect(result).toEqual({ ok: true, status: 'accepted' });
      expect(supabase.calls).toEqual([
        {
          fn: 'mark_knowledge_chunk_embedding_failed',
          args: {
            p_chunk_id: 'chunk-1',
            p_error: 'OpenAI API responded with status 429',
            p_embedding_input_hash: 'hash-1',
          },
        },
      ]);
    });

    it('returns rpc_error when the failure RPC fails', async () => {
      const supabase = makeSupabaseStub([
        { error: { message: 'permission denied for function mark_knowledge_chunk_embedding_failed' } },
      ]);

      const result = await markKnowledgeChunkEmbeddingFailed(supabase, {
        chunkId: 'chunk-1',
        error: 'embedding failed',
        embeddingInputHash: 'hash-1',
      });

      expect(result).toEqual({
        ok: false,
        reason: 'rpc_error',
        message: 'permission denied for function mark_knowledge_chunk_embedding_failed',
      });
    });

    it('redacts secrets, dense vectors, and long errors before RPC', async () => {
      const supabase = makeSupabaseStub();
      const denseVector = `[${Array.from({ length: 80 }, () => '0.123456789').join(',')}]`;

      await markKnowledgeChunkEmbeddingFailed(supabase, {
        chunkId: 'chunk-1',
        error: `failed with sk-proj-secret123456 ${denseVector} ${'x'.repeat(700)}`,
        embeddingInputHash: 'hash-1',
      });

      const sent = String(supabase.calls[0].args['p_error']);
      expect(sent).toContain('sk-***');
      expect(sent).toContain('[vector-redacted]');
      expect(sent).not.toContain('sk-proj-secret123456');
      expect(sent).not.toContain('0.123456789');
      expect(sent.length).toBeLessThanOrEqual(500);
    });
  });

  describe('sanitizeEmbeddingFailureReason', () => {
    it('uses object message when available', () => {
      expect(sanitizeEmbeddingFailureReason({ message: 'rpc down' })).toBe('rpc down');
    });
  });
});
