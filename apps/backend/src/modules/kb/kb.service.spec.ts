import { jest as jestGlobal } from '@jest/globals';

import { KbService } from './kb.service';
import { createMockSupabase } from '../../test/mock-supabase';

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

describe('KbService', () => {
  let service: KbService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    service = new KbService();
  });

  describe('sanitizeChunkMetadataForClient', () => {
    it('removes embedding-like keys and richTextContent (document-only field)', () => {
      const out = service.sanitizeChunkMetadataForClient({
        embedding: [0.1],
        richTextContent: 'secret',
        kind: 'rich_text',
      });
      expect(out).toEqual({ kind: 'rich_text' });
    });
  });

  describe('keywordScore', () => {
    const score = (query: string, chunks: Array<{ content: string; title: string; metadata?: Record<string, unknown> }>, topK = 10) => {
      return (service as never)['keywordScore'](
        query,
        chunks.map(c => ({
          id: 'c1',
          documentId: 'd1',
          title: c.title,
          source: 'test',
          content: c.content,
          metadata: c.metadata ?? {},
        })),
        topK,
      );
    };

    it('returns empty score for zero-query', () => {
      const result = score('', [{ content: 'Hello world', title: 'Test' }]);
      expect(result.length).toBe(1);
      expect(result[0]!.relevanceScore).toBe(0);
    });

    it('returns chunks sorted by relevance descending', () => {
      const chunks = [
        { content: 'Hello world', title: 'Test Doc' },
        { content: 'Hello world foo bar baz', title: 'Test Doc' },
        { content: 'Completely different content here', title: 'Other' },
      ];
      const result = score('hello world', chunks);
      // Chunk 3 has no token overlap and no phrase match → score = 0, filtered out
      expect(result.length).toBe(2);
      expect(result[0]!.relevanceScore).toBeGreaterThanOrEqual(result[1]!.relevanceScore);
    });

    it('exact content phrase match boosts score', () => {
      const chunks = [
        { content: 'Appointment booking hours are 9am to 5pm', title: 'Hours' },
        { content: 'Random other content', title: 'Other' },
      ];
      const result = score('appointment booking hours', chunks);
      expect(result[0]!.relevanceScore).toBeGreaterThan(0.2);
    });

    it('section title boosts retrieval for hours query', () => {
      const result = score(
        'hours',
        [
          { content: 'General welcome text only.', title: 'Note', metadata: { chunkType: 'section', sectionTitle: null } },
          {
            content: 'We open at nine.',
            title: 'Note',
            metadata: { chunkType: 'section', sectionTitle: 'OPENING HOURS' },
          },
        ],
        2,
      );
      expect(result[0]?.chunkId).toBeDefined();
      expect(result[0]?.content).toMatch(/nine|open/i);
    });
  });

  describe('retrieve — assistant profile document allowlist', () => {
    it('returns no chunks when documentIdAllowlist is empty (no KB scope)', async () => {
      const r = await service.retrieve({
        tenantId: 't1',
        conversationId: 'c1',
        query: 'hello',
        documentIdAllowlist: [],
      });
      expect(r.chunks).toEqual([]);
      expect(r.totalConsidered).toBe(0);
    });
  });

  describe('toRetrievalChunk', () => {
    it('clamps relevanceScore to [0, 1]', () => {
      const raw = {
        id: 'c1',
        documentId: 'd1',
        title: 'Test',
        source: 'test',
        content: 'Hello world',
        metadata: {},
      };
      const result1 = (service as never)['toRetrievalChunk'](raw, 1.5);
      expect(result1.relevanceScore).toBe(1);

      const result2 = (service as never)['toRetrievalChunk'](raw, -0.5);
      expect(result2.relevanceScore).toBe(0);
    });

    it('maps raw chunk to RetrievalChunk shape', () => {
      const raw = {
        id: 'c1',
        documentId: 'd1',
        title: 'Test',
        source: 'test',
        content: 'Content here',
        metadata: { key: 'value' },
      };
      const result = (service as never)['toRetrievalChunk'](raw, 0.8);
      expect(result.chunkId).toBe('c1');
      expect(result.title).toBe('Test');
      expect(result.relevanceScore).toBe(0.8);
    });
  });

  describe('embedding maintenance enqueue', () => {
    const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
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
    };

    it('does not enqueue when embedding jobs are disabled', async () => {
      const queue = { add: jestGlobal.fn(async () => undefined) };
      const svc = new KbService(queue as never);

      await withEnv(
        { NODE_ENV: 'staging', KB_EMBEDDING_JOBS_ENABLED: undefined, KB_EMBEDDING_JOB_TENANT_IDS: undefined },
        async () => {
          (svc as never)['enqueueKbEmbeddingRefresh']('tenant-1', 'doc-1', 'create');
        },
      );

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueues a document embedding refresh for allowlisted staging tenants', async () => {
      const queue = { add: jestGlobal.fn(async () => undefined) };
      const svc = new KbService(queue as never);

      await withEnv(
        { NODE_ENV: 'staging', KB_EMBEDDING_JOBS_ENABLED: 'true', KB_EMBEDDING_JOB_TENANT_IDS: 'tenant-1' },
        async () => {
          (svc as never)['enqueueKbEmbeddingRefresh']('tenant-1', 'doc-1', 'update');
        },
      );

      expect(queue.add).toHaveBeenCalledWith('kb-embedding-refresh', {
        tenantId: 'tenant-1',
        documentId: 'doc-1',
        reason: 'update',
      });
    });
  });

  describe('retrieve - legacy metadata.embedding ignored', () => {
    const PSEUDO_EMBED_DIMS = 64;

    function makeChain(data: unknown) {
      const self: any = {};
      self.select = jestGlobal.fn().mockReturnValue(self);
      self.eq = jestGlobal.fn().mockReturnValue(self);
      self.in = jestGlobal.fn().mockReturnValue(self);
      self.order = jestGlobal.fn().mockReturnValue(self);
      self.limit = jestGlobal.fn().mockResolvedValue({ data, error: null });
      self.single = jestGlobal.fn().mockResolvedValue({ data, error: null });
      self.maybeSingle = jestGlobal.fn().mockResolvedValue({ data, error: null });
      return self;
    }

    function setupMockChunks(
      chunks: Array<{ id: string; documentId: string; title?: string; source?: string; content: string; metadata: Record<string, unknown> }>,
    ) {
      const docIds = [...new Set(chunks.map(c => c.documentId))];
      const docs = docIds.map(id => {
        const c = chunks.find(x => x.documentId === id)!;
        return { id, title: c.title ?? 'Doc', source: c.source ?? 'manual', updated_at: '2020-01-01' };
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'knowledge_documents') {
          return makeChain(docs);
        }
        if (table === 'knowledge_chunks') {
          return makeChain(chunks.map(c => ({
            id: c.id,
            document_id: c.documentId,
            content: c.content,
            metadata: c.metadata,
          })));
        }
        return makeChain(null);
      });
    }

    beforeEach(() => {
      jestGlobal.clearAllMocks();
      service = new KbService();
    });

    it('returns retrievalMode=keyword when chunks have 64-dim metadata.embedding', async () => {
      setupMockChunks([
        {
          id: 'ch1',
          documentId: 'd1',
          title: 'Hours',
          source: 'manual',
          content: 'Appointment booking hours are 9am to 5pm',
          metadata: { embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.1) },
        },
      ]);

      const result = await service.retrieve({
        tenantId: 't1',
        conversationId: 'c1',
        query: 'appointment booking',
      });

      expect(result.retrievalMode).toBe('keyword');
      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('still scores content by keyword relevance when embeddings exist', async () => {
      setupMockChunks([
        {
          id: 'ch1',
          documentId: 'd1',
          content: 'Appointment booking hours are 9am to 5pm',
          metadata: { embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.1) },
        },
        {
          id: 'ch2',
          documentId: 'd2',
          content: 'Unrelated content about parking',
          metadata: { embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.2) },
        },
      ]);

      const result = await service.retrieve({
        tenantId: 't1',
        conversationId: 'c1',
        query: 'appointment booking',
      });

      expect(result.retrievalMode).toBe('keyword');
      for (const c of result.chunks) {
        expect(c.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(c.relevanceScore).toBeLessThanOrEqual(1);
      }
    });

    it('preserves keyword retrieval when embedding jobs flags are unset', async () => {
      setupMockChunks([
        {
          id: 'ch1',
          documentId: 'd1',
          content: 'Business hours are 9 to 5',
          metadata: { embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.1) },
        },
      ]);

      const result = await service.retrieve({
        tenantId: 't1',
        conversationId: 'c1',
        query: 'business hours',
      });

      expect(result.retrievalMode).toBe('keyword');
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]!.content).toBe('Business hours are 9 to 5');
    });

    it('non-canary tenant unaffected (same keyword retrieval)', async () => {
      setupMockChunks([
        {
          id: 'ch1',
          documentId: 'd1',
          content: 'Returns and refunds are processed within 30 days',
          metadata: { embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.1) },
        },
      ]);

      // Use a tenant ID that is NOT in any allowlist
      const result = await service.retrieve({
        tenantId: 'non-canary-tenant',
        conversationId: 'c1',
        query: 'returns policy',
      });

      expect(result.retrievalMode).toBe('keyword');
    });
  });

  describe('searchKnowledge - legacy metadata.embedding ignored', () => {
    const PSEUDO_EMBED_DIMS = 64;

    function makeChain(data: unknown) {
      const self: any = {};
      self.select = jestGlobal.fn().mockReturnValue(self);
      self.eq = jestGlobal.fn().mockReturnValue(self);
      self.in = jestGlobal.fn().mockReturnValue(self);
      self.order = jestGlobal.fn().mockReturnValue(self);
      self.limit = jestGlobal.fn().mockResolvedValue({ data, error: null });
      self.single = jestGlobal.fn().mockResolvedValue({ data, error: null });
      self.maybeSingle = jestGlobal.fn().mockResolvedValue({ data, error: null });
      return self;
    }

    function setupMockChunks(
      chunks: Array<{ id: string; documentId: string; title?: string; source?: string; content: string; metadata: Record<string, unknown> }>,
    ) {
      const docIds = [...new Set(chunks.map(c => c.documentId))];
      const docs = docIds.map(id => {
        const c = chunks.find(x => x.documentId === id)!;
        return { id, title: c.title ?? 'Doc', source: c.source ?? 'manual', updated_at: '2020-01-01' };
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'knowledge_documents') {
          return makeChain(docs);
        }
        if (table === 'knowledge_chunks') {
          return makeChain(chunks.map(c => ({
            id: c.id,
            document_id: c.documentId,
            content: c.content,
            metadata: c.metadata,
          })));
        }
        return makeChain(null);
      });
    }

    beforeEach(() => {
      jestGlobal.clearAllMocks();
      service = new KbService();
    });

    it('returns retrievalMode=keyword when chunks have 64-dim metadata.embedding', async () => {
      setupMockChunks([
        {
          id: 'ch1',
          documentId: 'd1',
          content: 'Appointment booking hours are 9am to 5pm',
          metadata: { embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.1) },
        },
      ]);

      const result = await service.searchKnowledge({
        tenantId: 't1',
        query: 'appointment booking',
      });

      expect(result.retrievalMode).toBe('keyword');
    });

    it('uses keyword scoring for ranking when embeddings exist', async () => {
      setupMockChunks([
        {
          id: 'ch1',
          documentId: 'd1',
          content: 'Appointment booking hours are 9am to 5pm',
          metadata: { embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.1) },
        },
        {
          id: 'ch2',
          documentId: 'd2',
          content: 'Parking is free on weekends',
          metadata: { embedding: new Array(PSEUDO_EMBED_DIMS).fill(0.2) },
        },
      ]);

      const result = await service.searchKnowledge({
        tenantId: 't1',
        query: 'booking hours',
      });

      expect(result.retrievalMode).toBe('keyword');
      expect(result.hits.length).toBeGreaterThan(0);
      // The booking-related chunk should rank higher by keyword score
      expect(result.hits[0]!.documentId).toBe('d1');
    });
  });
});
