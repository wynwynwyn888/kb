// KB retrieval DTOs — contracts for knowledge base retrieval

import type { KnowledgeSnippet } from '@aisbp/ai-router';

/**
 * Retrieval query input — a tenant-scoped search request.
 */
export interface RetrievalQuery {
  tenantId: string;
  conversationId: string;
  query: string; // raw user message
  topK?: number; // default 5
}

/**
 * A single retrieved chunk, ready for AI context injection.
 */
export interface RetrievalChunk {
  chunkId: string;
  documentId: string;
  content: string;
  title: string; // document title as label
  source: string; // e.g. "manual", "faq", "pdf", "web"
  relevanceScore: number; // 0-1
  metadata: Record<string, unknown>;
}

/**
 * Retrieval result set — all chunks returned for a query.
 */
export interface RetrievalResult {
  query: string;
  chunks: RetrievalChunk[];
  totalConsidered: number; // chunks considered in search
  retrievalMode: 'keyword' | 'vector' | 'hybrid';
}

/**
 * Lightweight retrieval metadata attached to orchestration log.
 */
export interface RetrievalMeta {
  chunksReturned: number;
  chunksConsidered: number;
  retrievalMode: 'keyword' | 'vector' | 'hybrid';
  topScore: number | null;
}
