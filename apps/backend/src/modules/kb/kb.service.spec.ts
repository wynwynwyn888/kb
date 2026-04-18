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

  describe('keywordScore', () => {
    const score = (query: string, chunks: Array<{ content: string; title: string }>) => {
      return (service as never)['keywordScore'](query, chunks.map(c => ({
        id: 'c1',
        documentId: 'd1',
        title: c.title,
        source: 'test',
        content: c.content,
        metadata: {},
      })));
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

    it('title exact match boost > content exact match boost', () => {
      const chunks = [
        { content: 'Pricing information', title: 'Pricing' },
        { content: 'Our pricing is competitive', title: 'Info' },
      ];
      const result = score('pricing', chunks);
      expect(result[0]!.title).toBe('Pricing');
    });
  });

  describe('tokenize', () => {
    const tokenize = (text: string) => {
      return [...(service as never)['tokenize'](text)];
    };

    it('lowercases input', () => {
      const tokens = tokenize('HELLO WORLD');
      expect(tokens).toContain('hello');
    });

    it('splits on whitespace', () => {
      const tokens = tokenize('hello world foo');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });

    it('strips punctuation', () => {
      const tokens = tokenize('hello, world! how are you?');
      expect(tokens).not.toContain('hello,');
      expect(tokens).toContain('hello');
    });

    it('filters tokens shorter than 2 chars', () => {
      const tokens = tokenize('a b hello c de f');
      expect(tokens).not.toContain('a');
      expect(tokens).not.toContain('b');
      expect(tokens).toContain('de');
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
});
