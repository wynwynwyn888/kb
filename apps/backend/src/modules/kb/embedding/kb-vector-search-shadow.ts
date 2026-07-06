// Isolated vector-search RPC wrapper for RAG shadow-lane testing.
//
// This helper calls only the real pgvector RPC. It intentionally ignores the
// legacy metadata.embedding pseudo-vector branch used by live keyword retrieval.

import { EMBEDDING_DIMENSIONS, toPgVectorText } from '../../../lib/kb-vector-serialize';
import type { SupabaseRpcLikeClient } from './kb-embedding-store';

export interface VectorSearchShadowParams {
  tenantId: string;
  queryEmbedding: number[];
  documentIdAllowlist?: string[] | null;
  limit?: number;
}

export interface VectorSearchShadowCandidate {
  chunkId: string;
  documentId: string;
  title: string | null;
  source: string | null;
  content: string;
  metadata: Record<string, unknown>;
  documentUpdatedAt: string | null;
  vectorScore: number;
}

export type VectorSearchShadowResult =
  | { ok: true; candidates: VectorSearchShadowCandidate[]; skipped?: 'empty_allowlist' }
  | { ok: false; reason: 'invalid_embedding' | 'rpc_error' | 'invalid_response'; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error ?? 'unknown error');
}

function clampLimit(limit: number | undefined): number {
  const n = Math.floor(Number(limit ?? 20));
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(n, 50);
}

function mapCandidate(row: unknown): VectorSearchShadowCandidate | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const chunkId = r['chunk_id'];
  const documentId = r['document_id'];
  const content = r['content'];
  const vectorScore = r['vector_score'];
  if (
    typeof chunkId !== 'string' ||
    typeof documentId !== 'string' ||
    typeof content !== 'string' ||
    typeof vectorScore !== 'number' ||
    !Number.isFinite(vectorScore)
  ) {
    return null;
  }
  const metadata = r['metadata'];
  return {
    chunkId,
    documentId,
    title: typeof r['title'] === 'string' ? r['title'] : null,
    source: typeof r['source'] === 'string' ? r['source'] : null,
    content,
    metadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    documentUpdatedAt:
      typeof r['document_updated_at'] === 'string' ? r['document_updated_at'] : null,
    vectorScore,
  };
}

export async function vectorSearchShadow(
  supabase: SupabaseRpcLikeClient,
  params: VectorSearchShadowParams,
): Promise<VectorSearchShadowResult> {
  if (params.documentIdAllowlist && params.documentIdAllowlist.length === 0) {
    return { ok: true, candidates: [], skipped: 'empty_allowlist' };
  }

  let queryEmbeddingText: string;
  try {
    queryEmbeddingText = toPgVectorText(params.queryEmbedding, EMBEDDING_DIMENSIONS);
  } catch (error) {
    return { ok: false, reason: 'invalid_embedding', message: errorMessage(error) };
  }

  const res = await supabase.rpc('match_knowledge_chunks', {
    p_tenant_id: params.tenantId,
    p_query_embedding: queryEmbeddingText,
    p_document_id_allowlist: params.documentIdAllowlist ?? null,
    p_limit: clampLimit(params.limit),
  });

  if (res.error) {
    return { ok: false, reason: 'rpc_error', message: errorMessage(res.error) };
  }

  if (!Array.isArray(res.data)) {
    return {
      ok: false,
      reason: 'invalid_response',
      message: 'match_knowledge_chunks returned non-array data',
    };
  }

  const candidates = res.data.map(mapCandidate);
  if (candidates.some((candidate) => candidate === null)) {
    return {
      ok: false,
      reason: 'invalid_response',
      message: 'match_knowledge_chunks returned malformed row',
    };
  }

  return {
    ok: true,
    candidates: candidates as VectorSearchShadowCandidate[],
  };
}
