// RAG vector context runner.
//
// SAFETY CONTRACT:
// - Default OFF.
// - Runs only in staging-like environments and explicit tenant allowlist.
// - Production-like envs require a separate exact canary acknowledgement.
// - Returns retrieval chunks for prompt context only when vector search succeeds
//   with sufficiently strong candidates.
// - Never throws; callers fall back to keyword retrieval on any failure.
// - Does not read KB_VECTOR_RETRIEVAL_ENABLED and does not affect production.

import { getSupabaseService } from '../../../lib/supabase';
import { safeTextPreviewForLog } from '../../../lib/safe-text-preview-for-log';
import type { RetrievalChunk, RetrievalResult } from '../dto/retrieval.dto';
import { OpenAiEmbeddingClient } from './openai-embedding.client';
import { resolveOpenAiEmbeddingCredentials, type SupabaseLikeClient } from './openai-key.resolver';
import { vectorSearchShadow, type VectorSearchShadowCandidate } from './kb-vector-search-shadow';
import type { BackfillSupabaseClient } from './kb-embedding-backfill';

const DEFAULT_MIN_VECTOR_SCORE = 0.3;
const DEFAULT_MAX_CONTEXT_CHARS = 6000;
export const KB_VECTOR_CONTEXT_PROD_CANARY_ACK = 'YES_ENABLE_KB_VECTOR_CONTEXT_PROD_CANARY';

export interface KbVectorContextLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface KbVectorContextParams {
  tenantId: string;
  conversationId?: string;
  query: string;
  documentIdAllowlist?: string[] | null;
  topK?: number;
}

export interface KbVectorContextEmbeddingClient {
  embedTexts: (texts: string[]) => Promise<Array<{ embedding: number[] }>>;
}

export interface KbVectorContextDeps {
  supabase?: BackfillSupabaseClient;
  embeddingClientFactory?: (creds: { apiKey: string; endpoint: string | null }) => KbVectorContextEmbeddingClient;
  logger?: KbVectorContextLogger;
}

export type KbVectorContextOutcome =
  | { ok: true; result: RetrievalResult; topChunkIds: string[] }
  | { ok: false; reason: string };

function runtimeEnvValues(): string[] {
  return [
    process.env['NODE_ENV'],
    process.env['APP_ENV'],
    process.env['RAILWAY_ENVIRONMENT'],
    process.env['VERCEL_ENV'],
  ]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function isStagingLikeEnv(): boolean {
  return runtimeEnvValues().some((v) => v === 'staging' || v === 'stage');
}

function isProductionLikeEnv(): boolean {
  return runtimeEnvValues().some((v) => v === 'production' || v === 'prod');
}

function vectorContextRuntimeAllowed(): boolean {
  if (isProductionLikeEnv()) {
    return process.env['KB_VECTOR_CONTEXT_PROD_CANARY_ACK'] === KB_VECTOR_CONTEXT_PROD_CANARY_ACK;
  }
  return isStagingLikeEnv();
}

export function kbVectorContextEnabledForTenant(tenantId: string): boolean {
  if (!vectorContextRuntimeAllowed()) return false;
  if (String(process.env['KB_VECTOR_CONTEXT_ENABLED'] ?? '').trim().toLowerCase() !== 'true') {
    return false;
  }
  const ids = String(process.env['KB_VECTOR_CONTEXT_TENANT_IDS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return false;
  return ids.includes(tenantId);
}

function contextMode(): string {
  return isProductionLikeEnv() ? 'prod_canary_vector_context' : 'staging_vector_context';
}

function readMinVectorScore(): number {
  const n = Number(process.env['KB_VECTOR_CONTEXT_MIN_SCORE']);
  if (!Number.isFinite(n)) return DEFAULT_MIN_VECTOR_SCORE;
  return Math.max(0, Math.min(1, n));
}

function safeLine(params: KbVectorContextParams, extra: Record<string, unknown>): string {
  return JSON.stringify({
    event: 'kb_vector_context',
    mode: contextMode(),
    tenantId: params.tenantId,
    conversationId: params.conversationId ?? 'n/a',
    queryPreview: safeTextPreviewForLog(params.query, { hashSalt: 'kbVectorContextQuery' }),
    ...extra,
  });
}

function toRetrievalChunk(candidate: VectorSearchShadowCandidate): RetrievalChunk {
  return {
    chunkId: candidate.chunkId,
    documentId: candidate.documentId,
    title: candidate.title ?? candidate.documentId,
    source: candidate.source ?? 'knowledge_vault',
    content: candidate.content,
    relevanceScore: candidate.vectorScore,
    metadata: {
      ...candidate.metadata,
      documentUpdatedAt: candidate.documentUpdatedAt,
      retrievalSource: 'rag_vector_context',
      vectorScore: candidate.vectorScore,
    },
  };
}

function boundContextChars(chunks: RetrievalChunk[], maxChars: number): RetrievalChunk[] {
  const out: RetrievalChunk[] = [];
  let used = 0;
  for (const chunk of chunks) {
    const len = chunk.content.length;
    if (out.length > 0 && used + len > maxChars) break;
    out.push(chunk);
    used += len;
  }
  return out;
}

export async function runKbVectorContext(
  params: KbVectorContextParams,
  deps: KbVectorContextDeps = {},
): Promise<KbVectorContextOutcome> {
  const startedAt = Date.now();
  const logger = deps.logger;
  try {
    const supabase = deps.supabase ?? (getSupabaseService() as unknown as BackfillSupabaseClient);
    const creds = await resolveOpenAiEmbeddingCredentials(
      supabase as unknown as SupabaseLikeClient,
      params.tenantId,
    );
    if (creds.ok === false) {
      logger?.log(safeLine(params, { fallbackReason: `no_openai_key:${creds.reason}` }));
      return { ok: false, reason: `no_openai_key:${creds.reason}` };
    }

    const client = deps.embeddingClientFactory
      ? deps.embeddingClientFactory(creds.credentials)
      : new OpenAiEmbeddingClient(creds.credentials);
    const embedded = await client.embedTexts([params.query]);
    const queryEmbedding = embedded[0]?.embedding;
    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger?.log(safeLine(params, { fallbackReason: 'query_embedding_empty' }));
      return { ok: false, reason: 'query_embedding_empty' };
    }

    const vector = await vectorSearchShadow(supabase, {
      tenantId: params.tenantId,
      queryEmbedding,
      documentIdAllowlist: params.documentIdAllowlist ?? null,
      limit: params.topK ?? 5,
    });
    if (vector.ok === false) {
      logger?.log(safeLine(params, { fallbackReason: vector.reason }));
      return { ok: false, reason: vector.reason };
    }

    const minScore = readMinVectorScore();
    const strong = vector.candidates.filter((c) => c.vectorScore >= minScore);
    if (strong.length === 0) {
      logger?.log(
        safeLine(params, {
          fallbackReason: 'weak_or_empty_vector_candidates',
          candidates: vector.candidates.length,
          minScore,
        }),
      );
      return { ok: false, reason: 'weak_or_empty_vector_candidates' };
    }

    const chunks = boundContextChars(
      strong.slice(0, Math.max(1, Math.min(10, params.topK ?? 5))).map(toRetrievalChunk),
      DEFAULT_MAX_CONTEXT_CHARS,
    );
    const result: RetrievalResult = {
      query: params.query,
      chunks,
      totalConsidered: vector.candidates.length,
      retrievalMode: 'vector',
    };
    logger?.log(
      safeLine(params, {
        candidates: vector.candidates.length,
        selectedContextCount: chunks.length,
        minScore,
        latencyMs: Date.now() - startedAt,
        topChunkIds: chunks.map((c) => c.chunkId),
      }),
    );
    return { ok: true, result, topChunkIds: chunks.map((c) => c.chunkId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(safeLine(params, { fallbackReason: 'exception', message }));
    return { ok: false, reason: 'exception' };
  }
}
