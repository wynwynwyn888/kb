import { describe, expect, it, jest as jestGlobal } from '@jest/globals';

import {
  OpenAiEmbeddingClient,
} from './openai-embedding.client';

// --------------- helpers ---------------

interface EmbeddingApiEntry {
  object: string;
  index: number;
  embedding: number[];
}

interface EmbeddingApiResponse {
  object: string;
  data: EmbeddingApiEntry[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

function okResponse(data: EmbeddingApiResponse): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function statusResponse(status: number): Response {
  return new Response('', { status });
}

function networkError(): Error {
  const e = new TypeError('fetch failed');
  e.name = 'TypeError';
  return e;
}

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

function makeEmbedding(dims: number): number[] {
  return Array.from({ length: dims }, (_, i) => Math.sin(i) * 0.1);
}

function embeddingResponse(
  entries: Array<{ index: number; embedding: number[] }>,
): EmbeddingApiResponse {
  return {
    object: 'list',
    data: entries.map((e) => ({
      object: 'embedding',
      index: e.index,
      embedding: e.embedding,
    })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: entries.length * 3, total_tokens: entries.length * 3 },
  };
}

const noRetryDelay = {
  sleep: async () => undefined,
  retryDelayMs: () => 0,
};

// --------------- tests ---------------

describe('OpenAiEmbeddingClient', () => {
  // --- config defaults ---

  describe('constructor defaults', () => {
    it('uses text-embedding-3-small as default model', async () => {
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: makeEmbedding(1536) }])),
      );
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });
      await client.embedTexts(['hello']);
      const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
      expect(body.model).toBe('text-embedding-3-small');
    });

    it('uses 1536 as default dimensions', () => {
      const client = new OpenAiEmbeddingClient({ apiKey: 'sk-key' });
      expect((client as never)['dimensions']).toBe(1536);
    });

    it('uses 5000 ms as default timeout', () => {
      const client = new OpenAiEmbeddingClient({ apiKey: 'sk-key' });
      expect((client as never)['timeoutMs']).toBe(5000);
    });

    it('uses maxConcurrency 5 by default', () => {
      const client = new OpenAiEmbeddingClient({ apiKey: 'sk-key' });
      expect((client as never)['maxConcurrency']).toBe(5);
    });

    it('uses maxRetries 3 by default', () => {
      const client = new OpenAiEmbeddingClient({ apiKey: 'sk-key' });
      expect((client as never)['maxRetries']).toBe(3);
    });

    it('uses maxInputsPerRequest 500 by default', () => {
      const client = new OpenAiEmbeddingClient({ apiKey: 'sk-key' });
      expect((client as never)['maxInputsPerRequest']).toBe(500);
    });

    it('accepts overrides for all config values', () => {
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-custom',
        endpoint: 'https://proxy.example.com',
        model: 'text-embedding-ada-002',
        dimensions: 768,
        timeoutMs: 10000,
        maxConcurrency: 3,
        maxRetries: 5,
        maxInputsPerRequest: 100,
      });
      const c = client as never;
      expect(c['apiKey']).toBe('sk-custom');
      expect(c['endpoint']).toBe('https://proxy.example.com');
      expect(c['model']).toBe('text-embedding-ada-002');
      expect(c['dimensions']).toBe(768);
      expect(c['timeoutMs']).toBe(10000);
      expect(c['maxConcurrency']).toBe(3);
      expect(c['maxRetries']).toBe(5);
      expect(c['maxInputsPerRequest']).toBe(100);
    });
  });

  // --- endpoint normalisation ---

  describe('endpoint normalisation', () => {
    it('defaults to https://api.openai.com/v1 when endpoint is null', () => {
      const client = new OpenAiEmbeddingClient({ apiKey: 'sk-x', endpoint: null });
      expect((client as never)['endpoint']).toBe('https://api.openai.com/v1');
    });

    it('defaults to https://api.openai.com/v1 when endpoint is undefined', () => {
      const client = new OpenAiEmbeddingClient({ apiKey: 'sk-x' });
      expect((client as never)['endpoint']).toBe('https://api.openai.com/v1');
    });

    it('defaults to https://api.openai.com/v1 when endpoint is empty string', () => {
      const client = new OpenAiEmbeddingClient({ apiKey: 'sk-x', endpoint: '   ' });
      expect((client as never)['endpoint']).toBe('https://api.openai.com/v1');
    });

    it('trims a single trailing slash', () => {
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-x',
        endpoint: 'https://api.openai.com/v1/',
      });
      expect((client as never)['endpoint']).toBe('https://api.openai.com/v1');
    });

    it('trims multiple trailing slashes', () => {
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-x',
        endpoint: 'https://proxy.example/openai///',
      });
      expect((client as never)['endpoint']).toBe('https://proxy.example/openai');
    });

    it('trims whitespace around endpoint', () => {
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-x',
        endpoint: '  https://custom.endpoint/v1  ',
      });
      expect((client as never)['endpoint']).toBe('https://custom.endpoint/v1');
    });
  });

  // --- empty input ---

  describe('empty input', () => {
    it('returns empty array without any HTTP call', async () => {
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>();
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });
      const result = await client.embedTexts([]);
      expect(result).toEqual([]);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  // --- happy path ---

  describe('happy path', () => {
    it('calls POST /embeddings with correct payload', async () => {
      const emb = makeEmbedding(1536);
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: emb }])),
      );
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await client.embedTexts(['hello world']);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      expect(init!.method).toBe('POST');
      expect(init!.headers!['Content-Type' as keyof HeadersInit]).toBe(
        'application/json',
      );
      expect(init!.headers!['Authorization' as keyof HeadersInit]).toBe(
        'Bearer sk-key',
      );
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.input).toEqual(['hello world']);
      expect(body.dimensions).toBe(1536);
    });

    it('uses custom endpoint in URL', async () => {
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: makeEmbedding(1536) }])),
      );
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        endpoint: 'https://my-openai.example.com/v1',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await client.embedTexts(['x']);

      expect(fetchFn.mock.calls[0]![0]).toBe(
        'https://my-openai.example.com/v1/embeddings',
      );
    });

    it('returns embeddings in correct order for single request', async () => {
      const emb0 = makeEmbedding(1536);
      const emb1 = makeEmbedding(1536);
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(
          embeddingResponse([
            { index: 0, embedding: emb0 },
            { index: 1, embedding: emb1 },
          ]),
        ),
      );
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      const results = await client.embedTexts(['first', 'second']);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ index: 0, embedding: emb0 });
      expect(results[1]).toEqual({ index: 1, embedding: emb1 });
    });

    it('passes AbortSignal to fetch', async () => {
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: makeEmbedding(1536) }])),
      );
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        timeoutMs: 7000,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await client.embedTexts(['x']);

      const init = fetchFn.mock.calls[0]![1]!;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // --- batching ---

  describe('batching', () => {
    it('splits many inputs into multiple requests', async () => {
      const emb = makeEmbedding(1536);
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockImplementation((_url, init) => {
          const input = JSON.parse(init?.body as string).input as string[];
          return Promise.resolve(
            okResponse(
              embeddingResponse(
                input.map((_, index) => ({ index, embedding: emb })),
              ),
            ),
          );
        });

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxInputsPerRequest: 2,
        maxConcurrency: 10,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      const texts = ['a', 'b', 'c', 'd', 'e'];
      await client.embedTexts(texts);

      // 5 inputs / 2 per request = 3 requests
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('preserves order across multiple batches', async () => {
      let call = 0;
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockImplementation(() => {
          const idx = call++;
          const emb = Array.from({ length: 1536 }, () => idx + Math.random());
          return Promise.resolve(
            okResponse(embeddingResponse([{ index: 0, embedding: emb }])),
          );
        });

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxInputsPerRequest: 1,
        maxConcurrency: 10,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      const results = await client.embedTexts(['z0', 'z1', 'z2']);
      expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
    });

    it('respects maxConcurrency by limiting parallel requests', async () => {
      const emb = makeEmbedding(1536);
      const concurrencySpy = jestGlobal.fn();

      let active = 0;
      let maxObserved = 0;
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () => {
          active++;
          maxObserved = Math.max(maxObserved, active);
          concurrencySpy(active);
          // Small delay to allow parallel calls to overlap
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return okResponse(embeddingResponse([{ index: 0, embedding: emb }]));
        });

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxInputsPerRequest: 1,
        maxConcurrency: 2,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await client.embedTexts(['a', 'b', 'c', 'd', 'e']);
      expect(maxObserved).toBeLessThanOrEqual(2);
    });
  });

  // --- retry behaviour ---

  describe('retry behaviour', () => {
    it('retries on 429 and succeeds', async () => {
      const emb = makeEmbedding(1536);
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(statusResponse(429))
        .mockResolvedValueOnce(statusResponse(429))
        .mockResolvedValueOnce(
          okResponse(embeddingResponse([{ index: 0, embedding: emb }])),
        );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxRetries: 3,
        fetch: fetchFn as typeof globalThis.fetch,
        ...noRetryDelay,
      });

      const results = await client.embedTexts(['test']);
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(1);
    });

    it('retries on 5xx and succeeds', async () => {
      const emb = makeEmbedding(1536);
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(statusResponse(503))
        .mockResolvedValueOnce(
          okResponse(embeddingResponse([{ index: 0, embedding: emb }])),
        );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxRetries: 3,
        fetch: fetchFn as typeof globalThis.fetch,
        ...noRetryDelay,
      });

      const results = await client.embedTexts(['test']);
      expect(results).toHaveLength(1);
    });

    it('retries on network error and succeeds', async () => {
      const emb = makeEmbedding(1536);
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockRejectedValueOnce(networkError())
        .mockResolvedValueOnce(
          okResponse(embeddingResponse([{ index: 0, embedding: emb }])),
        );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxRetries: 3,
        fetch: fetchFn as typeof globalThis.fetch,
        ...noRetryDelay,
      });

      const results = await client.embedTexts(['test']);
      expect(results).toHaveLength(1);
    });

    it('retries on AbortError / timeout and succeeds', async () => {
      const emb = makeEmbedding(1536);
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockRejectedValueOnce(abortError())
        .mockResolvedValueOnce(
          okResponse(embeddingResponse([{ index: 0, embedding: emb }])),
        );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxRetries: 3,
        fetch: fetchFn as typeof globalThis.fetch,
        ...noRetryDelay,
      });

      const results = await client.embedTexts(['test']);
      expect(results).toHaveLength(1);
    });

    it('gives up after exhausting all retries', async () => {
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(statusResponse(429));

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxRetries: 2,
        fetch: fetchFn as typeof globalThis.fetch,
        ...noRetryDelay,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        'OpenAI API responded with status 429',
      );
      // maxRetries + 1 original = 3 total calls
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('does not retry on non-retryable 4xx errors', async () => {
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(statusResponse(400));

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxRetries: 3,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        'OpenAI API responded with status 400',
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 401 unauthorized', async () => {
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(statusResponse(401));

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        maxRetries: 3,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        'OpenAI API responded with status 401',
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  // --- dimension validation ---

  describe('dimension validation', () => {
    it('rejects embeddings with wrong dimension count', async () => {
      const wrongEmb = Array.from({ length: 768 }, () => 0.1);
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: wrongEmb }])),
      );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        dimensions: 1536,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        /expected 1536 dimensions, got 768/,
      );
    });

    it('rejects embeddings with non-finite values', async () => {
      const badEmb = Array.from({ length: 1536 }, () => 0.1);
      badEmb[10] = NaN;
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: badEmb }])),
      );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        'non-finite values in embedding',
      );
    });

    it('rejects response missing data array', async () => {
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse({ object: 'list', model: 'm', usage: {} } as EmbeddingApiResponse),
      );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow('missing data array');
    });

    it('rejects response where data is not an array', async () => {
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse({
          object: 'list',
          data: { not: 'an array' },
          model: 'm',
          usage: {},
        } as unknown as EmbeddingApiResponse),
      );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow('missing data array');
    });

    it('rejects response with fewer embeddings than requested', async () => {
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: makeEmbedding(1536) }])),
      );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['first', 'second'])).rejects.toThrow(
        'expected 2 embeddings, got 1',
      );
    });

    it('rejects response with invalid embedding index', async () => {
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(
          embeddingResponse([
            { index: 0, embedding: makeEmbedding(1536) },
            { index: 99, embedding: makeEmbedding(1536) },
          ]),
        ),
      );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['first', 'second'])).rejects.toThrow(
        'invalid embedding index',
      );
    });
  });

  // --- safety: no secret / raw content leakage ---

  describe('safety - no secret or raw content leakage', () => {
    it('does not include apiKey in error message on auth failure', async () => {
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(statusResponse(401));

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-proj-secret-key-1234',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        /^(?!.*sk-proj-secret-key-1234).*$/s,
      );
    });

    it('does not include apiKey in error message on network failure', async () => {
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockRejectedValue(networkError());

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-proj-secret-key-1234',
        maxRetries: 0,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        /^(?!.*sk-proj-secret-key-1234).*$/s,
      );
    });

    it('does not include raw embedding values in error messages', async () => {
      const badEmb = Array.from({ length: 768 }, () => 0.123456789);
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: badEmb }])),
      );

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        dimensions: 1536,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        /^(?!.*0\.123456789).*$/s,
      );
    });

    it('does not leak apiKey prefix in error message', async () => {
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(statusResponse(500));

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-proj-abcdefghijklmnop',
        maxRetries: 0,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        /^(?!.*sk-proj).*$/s,
      );
    });

    it('redacts apiKey when it appears in an unexpected error context', async () => {
      // Simulate a weird error where fetch somehow echoes the key
      const err = new Error(
        'Connection refused to https://api.openai.com/v1/embeddings with key sk-proj-leaked-key-here',
      );
      const fetchFn = jestGlobal
        .fn<typeof globalThis.fetch>()
        .mockRejectedValue(err);

      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-proj-leaked-key-here',
        maxRetries: 0,
        fetch: fetchFn as typeof globalThis.fetch,
      });

      await expect(client.embedTexts(['test'])).rejects.toThrow(
        /^(?!.*sk-proj-leaked-key-here).*$/s,
      );
    });
  });

  // --- prepares inputs through Phase 1 helper ---

  describe('input preparation', () => {
    it('truncates oversized inputs via prepareEmbeddingInput', async () => {
      const emb = makeEmbedding(1536);
      const fetchFn = jestGlobal.fn<typeof globalThis.fetch>().mockResolvedValue(
        okResponse(embeddingResponse([{ index: 0, embedding: emb }])),
      );
      const client = new OpenAiEmbeddingClient({
        apiKey: 'sk-key',
        fetch: fetchFn as typeof globalThis.fetch,
      });

      const huge = 'x'.repeat(9000);
      await client.embedTexts([huge]);

      const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
      expect((body.input as string[])[0].length).toBeLessThanOrEqual(8000);
      expect((body.input as string[])[0]).not.toBe(huge);
    });
  });
});
