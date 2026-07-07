// RAG shadow-lane runner: log-only vector retrieval + hybrid comparison.
//
// SAFETY CONTRACT:
// - Invoked ONLY from the dedicated KB_VECTOR_SHADOW BullMQ worker (never inline
//   in the reply request). OpenAI/RPC work happens off the reply path.
// - Gated by a fail-closed feature flag (default OFF) + explicit tenant allowlist.
// - NEVER throws (all paths caught) — callers use `void run(...).catch(() => {})`.
// - NEVER returns data into the reply path and NEVER feeds vector candidates
//   into the customer-facing prompt. Its only effect is a safe diagnostic log.
// - Uses ONLY the real pgvector RPC; ignores the legacy metadata pseudo-vector path.
// - Does NOT read or depend on KB_VECTOR_RETRIEVAL_ENABLED (primary path is untouched).

import { getSupabaseService } from '../../../lib/supabase';
import { safeTextPreviewForLog } from '../../../lib/safe-text-preview-for-log';
import { prepareEmbeddingInputWithHash } from '../../../lib/kb-embedding-input';
import { compareRetrieval, rrfMerge, RRF_K } from '../../../lib/kb-hybrid-merge';
import { OpenAiEmbeddingClient } from './openai-embedding.client';
import { resolveOpenAiEmbeddingCredentials, type SupabaseLikeClient } from './openai-key.resolver';
import { vectorSearchShadow } from './kb-vector-search-shadow';
import type { BackfillSupabaseClient } from './kb-embedding-backfill';

export interface KbVectorShadowLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface KbVectorShadowKeywordCandidate {
  chunkId: string;
  score?: number;
}

export interface KbVectorShadowParams {
  tenantId: string;
  conversationId?: string;
  query: string;
  intentHint?: string;
  documentIdAllowlist?: string[] | null;
  /** Keyword chunk IDs/scores from the reply's keyword retrieval, for comparison. */
  keywordCandidates?: KbVectorShadowKeywordCandidate[];
  limit?: number;
}

export interface KbVectorShadowEmbeddingClient {
  embedTexts: (texts: string[]) => Promise<Array<{ embedding: number[] }>>;
}

/** Optional injectable cache for query embeddings (owned by the worker). */
export interface QueryEmbeddingCache {
  get: (key: string) => number[] | undefined;
  set: (key: string, value: number[]) => void;
}

export interface KbVectorShadowDeps {
  /** Defaults to the shared Supabase service client. Injectable for tests. */
  supabase?: BackfillSupabaseClient;
  /** Injectable embedding client factory for tests. */
  embeddingClientFactory?: (creds: { apiKey: string; endpoint: string | null }) => KbVectorShadowEmbeddingClient;
  /** Query-embedding cache (LRU) owned by the worker; errors are never cached. */
  queryEmbeddingCache?: QueryEmbeddingCache;
  logger?: KbVectorShadowLogger;
}

export type KbVectorShadowOutcome =
  | { ok: true; count: number; topChunkIds: string[] }
  | { ok: false; reason: string };

/**
 * Fail-closed flag check. Reads env each call. Vector shadow runs only when
 * KB_VECTOR_SHADOW_ENABLED=true AND the tenant is explicitly listed in
 * KB_VECTOR_SHADOW_TENANT_IDS. Empty/unset list => no tenant runs.
 *
 * Deliberately does NOT read KB_VECTOR_RETRIEVAL_ENABLED — the shadow lane is
 * independent of the production vector-retrieval flag.
 */
export function kbVectorShadowEnabledForTenant(tenantId: string): boolean {
  if (String(process.env['KB_VECTOR_SHADOW_ENABLED'] ?? '').trim().toLowerCase() !== 'true') {
    return false;
  }
  const ids = String(process.env['KB_VECTOR_SHADOW_TENANT_IDS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return false;
  return ids.includes(tenantId);
}

function safeLine(params: KbVectorShadowParams, extra: Record<string, unknown>): string {
  const base: Record<string, unknown> = {
    event: 'kb_vector_shadow',
    mode: 'shadow_no_reply_impact',
    no_reply_impact: true,
    tenantId: params.tenantId,
    conversationId: params.conversationId ?? 'n/a',
    intentHint: params.intentHint ?? 'none',
    documentScope:
      params.documentIdAllowlist === null || params.documentIdAllowlist === undefined
        ? 'all'
        : `allowlist:${params.documentIdAllowlist.length}`,
    queryPreview: safeTextPreviewForLog(params.query, { hashSalt: 'kbVectorShadowQuery' }),
    ...extra,
  };
  return JSON.stringify(base);
}

/**
 * Runs the shadow vector retrieval + hybrid comparison and logs the result
 * safely. Returns an outcome for diagnostics/tests only — callers MUST NOT use
 * it to alter replies. Never throws.
 */
export async function runKbVectorShadow(
  params: KbVectorShadowParams,
  deps: KbVectorShadowDeps = {},
): Promise<KbVectorShadowOutcome> {
  const logger = deps.logger;
  const startedAt = Date.now();
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

    // Embed the exact prepared/truncated input; key the cache by its hash so the
    // worker and DB write path agree on what was embedded.
    const prepared = prepareEmbeddingInputWithHash(params.query);
    let queryEmbedding = deps.queryEmbeddingCache?.get(prepared.hash);
    const cacheHit = queryEmbedding !== undefined && queryEmbedding.length > 0;
    let embedMs = 0;
    if (!cacheHit) {
      const client: KbVectorShadowEmbeddingClient = deps.embeddingClientFactory
        ? deps.embeddingClientFactory(creds.credentials)
        : new OpenAiEmbeddingClient(creds.credentials);
      const embedStartedAt = Date.now();
      const embedded = await client.embedTexts([prepared.input]);
      embedMs = Date.now() - embedStartedAt;
      queryEmbedding = embedded[0]?.embedding;
      if (!queryEmbedding || queryEmbedding.length === 0) {
        // Do NOT cache empty/error embeddings.
        logger?.log(safeLine(params, { fallbackReason: 'query_embedding_empty', embedMs }));
        return { ok: false, reason: 'query_embedding_empty' };
      }
      deps.queryEmbeddingCache?.set(prepared.hash, queryEmbedding);
    }

    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger?.log(safeLine(params, { fallbackReason: 'query_embedding_empty', cacheHit, embedMs }));
      return { ok: false, reason: 'query_embedding_empty' };
    }

    const searchStartedAt = Date.now();
    const result = await vectorSearchShadow(supabase, {
      tenantId: params.tenantId,
      queryEmbedding,
      documentIdAllowlist: params.documentIdAllowlist ?? null,
      limit: params.limit ?? 10,
    });
    const searchMs = Date.now() - searchStartedAt;

    if (result.ok === false) {
      logger?.log(safeLine(params, { fallbackReason: result.reason, cacheHit, embedMs, searchMs }));
      return { ok: false, reason: result.reason };
    }

    const vectorRanked = result.candidates.map((c) => ({ chunkId: c.chunkId, score: c.vectorScore }));
    const keywordRanked = (params.keywordCandidates ?? []).map((c) => ({
      chunkId: c.chunkId,
      score: typeof c.score === 'number' ? c.score : undefined,
    }));

    const hybrid = rrfMerge(vectorRanked, keywordRanked, RRF_K);
    const comparison = compareRetrieval(
      keywordRanked.map((c) => c.chunkId),
      vectorRanked.map((c) => c.chunkId),
    );

    const vectorTop = vectorRanked.slice(0, 5).map((c, i) => ({
      rank: i + 1,
      chunkId: c.chunkId,
      vectorScore: Number(c.score.toFixed(6)),
    }));
    const keywordTop = keywordRanked.slice(0, 5).map((c, i) => ({
      rank: i + 1,
      chunkId: c.chunkId,
      keywordScore: typeof c.score === 'number' ? Number(c.score.toFixed(6)) : null,
    }));
    const hybridTop = hybrid.slice(0, 5).map((c, i) => ({
      rank: i + 1,
      chunkId: c.chunkId,
      rrfScore: Number(c.rrfScore.toFixed(6)),
      vectorRank: c.vectorRank,
      keywordRank: c.keywordRank,
    }));

    logger?.log(
      safeLine(params, {
        rrfK: RRF_K,
        keywordCount: comparison.keywordCount,
        vectorCount: comparison.vectorCount,
        overlapCount: comparison.overlapCount,
        jaccard: Number(comparison.jaccard.toFixed(4)),
        sameTopChunk: comparison.sameTopChunk,
        vectorOnlyChunkIds: JSON.stringify(comparison.vectorOnlyChunkIds.slice(0, 10)),
        keywordOnlyChunkIds: JSON.stringify(comparison.keywordOnlyChunkIds.slice(0, 10)),
        keywordTop: JSON.stringify(keywordTop),
        vectorTop: JSON.stringify(vectorTop),
        hybridTop: JSON.stringify(hybridTop),
        cacheHit,
        embedMs,
        searchMs,
        latencyMs: Date.now() - startedAt,
        fallbackReason: 'none',
      }),
    );

    return {
      ok: true,
      count: result.candidates.length,
      topChunkIds: vectorTop.map((t) => t.chunkId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(safeLine(params, { fallbackReason: 'exception', message }));
    return { ok: false, reason: 'exception' };
  }
}
