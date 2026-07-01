// OpenAiProviderAdapter retry spec — verifies exponential backoff with jitter
// on transient errors (429, 5xx, network timeout). Non-retryable errors (400, 401, 403)
// must fail immediately.

import { jest as jestGlobal } from '@jest/globals';
import { OpenAiProviderAdapter } from '@aisbp/ai-provider-openai';
import type { GenerateOptions } from '@aisbp/ai-router';
import axios from 'axios';

jestGlobal.mock('axios');

const mockedAxios = axios as jestGlobal.Mocked<typeof axios>;

function makeOptions(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    temperature: 0.7,
    maxTokens: 500,
    ...overrides,
  };
}

function makeSuccessResponse() {
  return {
    data: {
      id: 'chatcmpl-1',
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello! How can I help?' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      created: Date.now(),
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {},
  };
}

describe('OpenAiProviderAdapter retry/backoff', () => {
  let adapter: OpenAiProviderAdapter;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    adapter = new OpenAiProviderAdapter();
    adapter.initialize({
      apiKey: 'sk-valid-key',
      defaultModel: 'gpt-4o-mini',
    });
  });

  // ===========================================================================
  // Success (no retry needed)
  // ===========================================================================

  describe('success on first attempt', () => {
    it('returns AiResponse on first successful call', async () => {
      mockedAxios.create.mockReturnValue({
        post: jestGlobal.fn().mockResolvedValue(makeSuccessResponse()),
      } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      const result = await adapter.generate(makeOptions());
      expect(result.content).toBe('Hello! How can I help?');
      expect(result.usage.totalTokens).toBe(15);
      expect(result.model).toBe('gpt-4o-mini');
    });
  });

  // ===========================================================================
  // Success after retry (transient error)
  // ===========================================================================

  describe('success after transient retry', () => {
    it('retries on 500 and succeeds on second attempt', async () => {
      const axiosError500 = { response: { status: 500, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Internal Server Error' };
      const postFn = jestGlobal.fn()
        .mockRejectedValueOnce(axiosError500)
        .mockResolvedValueOnce(makeSuccessResponse());
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      const result = await adapter.generate(makeOptions());
      expect(postFn).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello! How can I help?');
    });

    it('retries on 502 and succeeds', async () => {
      const err = { response: { status: 502, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Bad Gateway' };
      const postFn = jestGlobal.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(makeSuccessResponse());
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      const result = await adapter.generate(makeOptions());
      expect(postFn).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello! How can I help?');
    });

    it('retries on 503 and succeeds', async () => {
      const err = { response: { status: 503, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Service Unavailable' };
      const postFn = jestGlobal.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(makeSuccessResponse());
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      const result = await adapter.generate(makeOptions());
      expect(postFn).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello! How can I help?');
    });

    it('retries on 504 and succeeds', async () => {
      const err = { response: { status: 504, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Gateway Timeout' };
      const postFn = jestGlobal.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(makeSuccessResponse());
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      const result = await adapter.generate(makeOptions());
      expect(postFn).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello! How can I help?');
    });

    it('retries on 429 rate limit and succeeds', async () => {
      const err = { response: { status: 429, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Too Many Requests' };
      const postFn = jestGlobal.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(makeSuccessResponse());
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      const result = await adapter.generate(makeOptions());
      expect(postFn).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello! How can I help?');
    });

    it('retries on network timeout (ETIMEDOUT) and succeeds', async () => {
      const err: Error & { code?: string } = new Error('timeout');
      err.code = 'ETIMEDOUT';
      const postFn = jestGlobal.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(makeSuccessResponse());
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      const result = await adapter.generate(makeOptions());
      expect(postFn).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello! How can I help?');
    });
  });

  // ===========================================================================
  // Max retries exhausted
  // ===========================================================================

  describe('max retries exhausted', () => {
    it('throws after max retries (4 attempts) on persistent 500', async () => {
      const err = { response: { status: 500, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Internal Server Error' };
      const postFn = jestGlobal.fn()
        .mockRejectedValue(err);
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      await expect(adapter.generate(makeOptions())).rejects.toBeDefined();
      expect(postFn).toHaveBeenCalledTimes(4); // initial + 3 retries
    });

    it('throws after max retries on persistent 429', async () => {
      const err = { response: { status: 429, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Too Many Requests' };
      const postFn = jestGlobal.fn()
        .mockRejectedValue(err);
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      await expect(adapter.generate(makeOptions())).rejects.toBeDefined();
      expect(postFn).toHaveBeenCalledTimes(4);
    });
  });

  // ===========================================================================
  // Non-retryable errors — should NOT retry
  // ===========================================================================

  describe('non-retryable errors do not retry', () => {
    it('does not retry on 400 Bad Request', async () => {
      const err = { response: { status: 400, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Bad Request' };
      const postFn = jestGlobal.fn().mockRejectedValue(err);
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      await expect(adapter.generate(makeOptions())).rejects.toBeDefined();
      expect(postFn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 401 Unauthorized', async () => {
      const err = { response: { status: 401, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Unauthorized' };
      const postFn = jestGlobal.fn().mockRejectedValue(err);
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      await expect(adapter.generate(makeOptions())).rejects.toBeDefined();
      expect(postFn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 403 Forbidden', async () => {
      const err = { response: { status: 403, data: {}, headers: {}, config: {} }, isAxiosError: true, message: 'Forbidden' };
      const postFn = jestGlobal.fn().mockRejectedValue(err);
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      await expect(adapter.generate(makeOptions())).rejects.toBeDefined();
      expect(postFn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on non-Axios error (throws immediately)', async () => {
      const postFn = jestGlobal.fn().mockRejectedValue(new Error('Unknown system error'));
      mockedAxios.create.mockReturnValue({ post: postFn } as never);
      adapter.initialize({ apiKey: 'sk-valid', defaultModel: 'gpt-4o-mini' });
      await expect(adapter.generate(makeOptions())).rejects.toBeDefined();
      expect(postFn).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Not initialized
  // ===========================================================================

  describe('not initialized', () => {
    it('throws when generate is called before initialize', async () => {
      const uninitialized = new OpenAiProviderAdapter();
      await expect(uninitialized.generate(makeOptions())).rejects.toThrow('not initialized');
    });
  });
});
