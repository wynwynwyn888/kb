// Isolated RPC storage helper for RAG shadow-lane embeddings.
//
// This module is intentionally not wired into Nest, queues, or any reply path.
// It only adapts validated embeddings/failures into the service-role RPCs
// created by the additive pgvector migration.

import { EMBEDDING_DIMENSIONS, toPgVectorText } from '../../../lib/kb-vector-serialize';

export interface SupabaseRpcLikeClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface StoreKnowledgeChunkEmbeddingParams {
  tenantId: string;
  chunkId: string;
  embedding: number[];
  embeddingModel: string;
  embeddingInputHash: string;
}

export interface MarkKnowledgeChunkEmbeddingFailedParams {
  tenantId: string;
  chunkId: string;
  error: unknown;
  embeddingInputHash: string;
}

export type KbEmbeddingStoreResult =
  | { ok: true; status: 'accepted' }
  | {
      ok: false;
      reason: 'invalid_embedding' | 'rpc_error';
      message: string;
    };

const MAX_ERROR_CHARS = 500;

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return String(error ?? 'unknown error');
}

export function sanitizeEmbeddingFailureReason(error: unknown): string {
  const raw = stringifyError(error)
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/\[[0-9eE.,+\-\s]{80,}\]/g, '[vector-redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return raw.slice(0, MAX_ERROR_CHARS);
}

function rpcErrorMessage(error: unknown): string {
  const safe = sanitizeEmbeddingFailureReason(error);
  return safe || 'embedding RPC failed';
}

export async function storeKnowledgeChunkEmbedding(
  supabase: SupabaseRpcLikeClient,
  params: StoreKnowledgeChunkEmbeddingParams,
): Promise<KbEmbeddingStoreResult> {
  let embeddingText: string;
  try {
    embeddingText = toPgVectorText(params.embedding, EMBEDDING_DIMENSIONS);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_embedding',
      message: rpcErrorMessage(error),
    };
  }

  const res = await supabase.rpc('set_knowledge_chunk_embedding', {
    p_tenant_id: params.tenantId,
    p_chunk_id: params.chunkId,
    p_embedding: embeddingText,
    p_embedding_model: params.embeddingModel,
    p_embedding_input_hash: params.embeddingInputHash,
  });

  if (res.error) {
    return { ok: false, reason: 'rpc_error', message: rpcErrorMessage(res.error) };
  }

  return { ok: true, status: 'accepted' };
}

export async function markKnowledgeChunkEmbeddingFailed(
  supabase: SupabaseRpcLikeClient,
  params: MarkKnowledgeChunkEmbeddingFailedParams,
): Promise<KbEmbeddingStoreResult> {
  const res = await supabase.rpc('mark_knowledge_chunk_embedding_failed', {
    p_tenant_id: params.tenantId,
    p_chunk_id: params.chunkId,
    p_error: sanitizeEmbeddingFailureReason(params.error),
    p_embedding_input_hash: params.embeddingInputHash,
  });

  if (res.error) {
    return { ok: false, reason: 'rpc_error', message: rpcErrorMessage(res.error) };
  }

  return { ok: true, status: 'accepted' };
}
