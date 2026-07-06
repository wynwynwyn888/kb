// RAG shadow-lane runner: fire-and-forget, log-only vector retrieval.
//
// SAFETY CONTRACT:
// - Invoked from orchestration AFTER the normal keyword KB retrieval.
// - Gated by a fail-closed feature flag (default OFF) + explicit tenant allowlist.
// - NEVER throws (all paths caught) — callers use `void run(...).catch(() => {})`.
// - NEVER returns data into the reply path and NEVER feeds vector candidates
//   into the customer-facing prompt. Its only effect is a safe diagnostic log.
// - Uses ONLY the real pgvector RPC; ignores the legacy metadata pseudo-vector path.
// - Does NOT read or depend on KB_VECTOR_RETRIEVAL_ENABLED (primary path is untouched).

import { getSupabaseService } from '../../../lib/supabase';
import { safeTextPreviewForLog } from '../../../lib/safe-text-preview-for-log';
import { OpenAiEmbeddingClient } from './openai-embedding.client';
import { resolveOpenAiEmbeddingCredentials, type SupabaseLikeClient } from './openai-key.resolver';
import { vectorSearchShadow } from './kb-vector-search-shadow';
import type { BackfillSupabaseClient } from './kb-embedding-backfill';

export interface KbVectorShadowLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface KbVectorShadowParams {
  tenantId: string;
  conversationId?: string;
  query: string;
  documentIdAllowlist?: string[] | null;
  limit?: number;
}

export interface KbVectorShadowEmbeddingClient {
  embedTexts: (texts: string[]) => Promise<Array<{ embedding: number[] }>>;
}

export interface KbVectorShadowDeps {
  /** Defaults to the shared Supabase service client. Injectable for tests. */
  supabase?: BackfillSupabaseClient;
  /** Injectable embedding client factory for tests. */
  embeddingClientFactory?: (creds: { apiKey: string; endpoint: string | null }) => KbVectorShadowEmbeddingClient;
  logger?: KbVectorShadowLogger;
}

export type KbVectorShadowOutcome =
  | { ok: true; count: number; topChunkIds: string[] }
  | { ok: false; reason: string };

/**
 * Fail-closed flag check. Reads env each call. Vector shadow runs only when
 * KB_VECTOR_SHADOW_ENABLED=true AND the tenant is explicitly listed in
 * KB_VECTOR_SHADOW_TENANT_IDS. Empty/unset list => no tenant runs.
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

function safeLine(params: KbVectorShadowParams, extra: Record<string, string | number>): string {
  const base: Record<string, unknown> = {
    event: 'kb_vector_shadow',
    mode: 'shadow_no_reply_impact',
    tenantId: params.tenantId,
    conversationId: params.conversationId ?? 'n/a',
    queryPreview: safeTextPreviewForLog(params.query, { hashSalt: 'kbVectorShadowQuery' }),
    ...extra,
  };
  return JSON.stringify(base);
}

/**
 * Runs the shadow vector retrieval and logs candidates safely. Returns an
 * outcome for diagnostics/tests only — callers MUST NOT use it to alter replies.
 * Never throws.
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

    const client: KbVectorShadowEmbeddingClient = deps.embeddingClientFactory
      ? deps.embeddingClientFactory(creds.credentials)
      : new OpenAiEmbeddingClient(creds.credentials);

    const embedded = await client.embedTexts([params.query]);
    const queryEmbedding = embedded[0]?.embedding;
    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger?.log(safeLine(params, { fallbackReason: 'query_embedding_empty' }));
      return { ok: false, reason: 'query_embedding_empty' };
    }

    const result = await vectorSearchShadow(supabase, {
      tenantId: params.tenantId,
      queryEmbedding,
      documentIdAllowlist: params.documentIdAllowlist ?? null,
      limit: params.limit ?? 10,
    });

    if (result.ok === false) {
      logger?.log(safeLine(params, { fallbackReason: result.reason }));
      return { ok: false, reason: result.reason };
    }

    const top = result.candidates.slice(0, 5).map((c, i) => ({
      rank: i + 1,
      chunkId: c.chunkId,
      documentId: c.documentId,
      vectorScore: Number(c.vectorScore.toFixed(6)),
      preview: safeTextPreviewForLog(c.content, { hashSalt: c.chunkId }),
    }));

    logger?.log(
      safeLine(params, {
        candidates: result.candidates.length,
        latencyMs: Date.now() - startedAt,
        top: JSON.stringify(top),
      }),
    );

    return { ok: true, count: result.candidates.length, topChunkIds: top.map((t) => t.chunkId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(safeLine(params, { fallbackReason: 'exception', message }));
    return { ok: false, reason: 'exception' };
  }
}
