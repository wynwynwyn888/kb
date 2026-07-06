// OpenAI-compatible embedding client for the RAG shadow lane.
//
// Isolated module - intentionally NOT wired into any runtime path in this
// change. It is exported for unit testing and for the later shadow processor
// to consume. It performs no work unless explicitly called.
//
// Defaults to `text-embedding-3-small` at 1536 dims. All fetch calls use a
// configurable timeout, transient retry/backoff for 429/5xx/network errors,
// and never leak raw content or credentials in error messages or logs.

import { prepareEmbeddingInput } from '../../../lib/kb-embedding-input';
import { EMBEDDING_DIMENSIONS, isValidEmbedding } from '../../../lib/kb-vector-serialize';

// --------------- defaults ---------------

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_CONCURRENCY = 5;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_INPUTS_PER_REQUEST = 500;
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1';

// --------------- retry backoff ---------------

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function backoffDelay(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * 1000;
  return Math.min(base + jitter, RETRY_MAX_DELAY_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class OpenAiEmbeddingHttpError extends Error {
  constructor(readonly status: number) {
    super(`OpenAI API responded with status ${status}`);
  }
}

async function fetchWithTimeout(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// --------------- URL sanitisation ---------------

function normalizeEndpoint(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return DEFAULT_ENDPOINT;
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_ENDPOINT;
}

// --------------- error redaction ---------------

function redactSecret(message: string, secret: string): string {
  if (!secret) return message;
  // Replace the full key if it appears anywhere in the message.
  let safe = message.split(secret).join('***');
  // Also catch partials that might be long enough to be identifiable.
  if (secret.length > 8) {
    const prefix = secret.slice(0, 4);
    safe = safe.split(prefix).join('sk-...');
  }
  return safe;
}

// --------------- public types ---------------

export interface OpenAiEmbeddingClientConfig {
  apiKey: string;
  /** Custom base URL override (e.g. Azure / proxy). Defaults to OpenAI. */
  endpoint?: string | null;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
  maxConcurrency?: number;
  maxRetries?: number;
  maxInputsPerRequest?: number;
  /** Injectable fetch for testing. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** Injectable sleep for tests; production uses real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable retry delay calculator for tests; production uses backoff. */
  retryDelayMs?: (attempt: number) => number;
}

export interface EmbeddingResult {
  index: number;
  embedding: number[];
}

// --------------- wire types ---------------

interface EmbeddingRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
}

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

// --------------- client ---------------

export class OpenAiEmbeddingClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly maxInputsPerRequest: number;
  private readonly _fetch: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retryDelayMs: (attempt: number) => number;

  constructor(config: OpenAiEmbeddingClientConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? EMBEDDING_DIMENSIONS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxConcurrency = config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxInputsPerRequest =
      config.maxInputsPerRequest ?? DEFAULT_MAX_INPUTS_PER_REQUEST;
    this._fetch = config.fetch ?? globalThis.fetch;
    this.sleep = config.sleep ?? wait;
    this.retryDelayMs = config.retryDelayMs ?? backoffDelay;
  }

  // ---- public API ----

  /**
   * Embed a list of texts. Results are ordered by original index. An empty
   * input array returns an empty result without touching the network.
   */
  async embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const prepared = texts.map((t, i) => ({
      index: i,
      input: prepareEmbeddingInput(t),
    }));

    const batches = chunk(prepared, this.maxInputsPerRequest);

    const all: EmbeddingResult[] = [];
    for (let i = 0; i < batches.length; i += this.maxConcurrency) {
      const slice = batches.slice(i, i + this.maxConcurrency);
      const settled = await Promise.allSettled(
        slice.map((b) => this.#embedOneBatch(b)),
      );
      for (const s of settled) {
        if (s.status === 'rejected') throw s.reason;
        all.push(...s.value);
      }
    }

    all.sort((a, b) => a.index - b.index);
    return all;
  }

  // ---- private ----

  async #embedOneBatch(
    batch: Array<{ index: number; input: string }>,
  ): Promise<EmbeddingResult[]> {
    const inputs = batch.map((b) => b.input);

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const response = await fetchWithTimeout(
          this._fetch,
          `${this.endpoint}/embeddings`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              input: inputs,
              ...(this.dimensions ? { dimensions: this.dimensions } : {}),
            } satisfies EmbeddingRequest),
          },
          this.timeoutMs,
        );

        if (!response.ok) {
          const status = response.status;
          if (isRetryableStatus(status) && attempt <= this.maxRetries) {
            await this.sleep(this.retryDelayMs(attempt));
            continue;
          }
          throw new OpenAiEmbeddingHttpError(status);
        }

        const body = (await response.json()) as EmbeddingApiResponse;

        if (!body.data || !Array.isArray(body.data)) {
          throw new Error('Invalid embedding response: missing data array');
        }

        if (body.data.length !== batch.length) {
          throw new Error(
            `Invalid embedding response: expected ${batch.length} embeddings, got ${body.data.length}`,
          );
        }

        const seenIndexes = new Set<number>();
        for (const entry of body.data) {
          if (
            !Number.isInteger(entry.index) ||
            entry.index < 0 ||
            entry.index >= batch.length ||
            seenIndexes.has(entry.index)
          ) {
            throw new Error('Invalid embedding response: invalid embedding index');
          }
          seenIndexes.add(entry.index);
          if (!isValidEmbedding(entry.embedding)) {
            throw new Error(
              'Invalid embedding response: non-finite values in embedding',
            );
          }
          if (entry.embedding.length !== this.dimensions) {
            throw new Error(
              `Invalid embedding response: expected ${this.dimensions} dimensions, got ${entry.embedding.length}`,
            );
          }
        }

        return body.data.map((entry) => ({
          index: batch[entry.index]?.index ?? entry.index,
          embedding: entry.embedding,
        }));
      } catch (err) {
        const isAbort =
          err instanceof DOMException
            ? err.name === 'AbortError'
            : err instanceof Error && err.name === 'AbortError';
        const isNetwork =
          err instanceof TypeError ||
          (err instanceof Error &&
            (err.message.includes('fetch') || err.message.includes('network')));
        const statusErr =
          err instanceof OpenAiEmbeddingHttpError && isRetryableStatus(err.status);

        if (attempt <= this.maxRetries) {
          if (isAbort || isNetwork || statusErr) {
            await this.sleep(this.retryDelayMs(attempt));
            continue;
          }
        }

        // Non-retryable or out of retries - sanitise and throw.
        const raw =
          err instanceof Error ? err.message : String(err ?? 'unknown error');
        throw new Error(redactSecret(raw, this.apiKey));
      }
    }

    throw new Error('Embedding request failed after all retries');
  }
}

// ---- tiny internal helper ----

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
