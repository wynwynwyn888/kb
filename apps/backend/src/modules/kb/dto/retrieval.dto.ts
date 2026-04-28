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
  /** Optional intent label (e.g. `BUSINESS_HOURS`) for generic retrieval scoring */
  intentHint?: string;
}

/**
 * Single hit from KB search UI / diagnostics (not the full chunk body).
 */
export interface KbSearchHit {
  documentId: string;
  documentTitle: string;
  sectionTitle: string | null;
  snippet: string;
  score: number;
  chunkId: string;
}

export interface KbSearchResponse {
  query: string;
  hits: KbSearchHit[];
  totalConsidered: number;
  retrievalMode: 'keyword' | 'vector' | 'hybrid';
}

export interface KbRichTextDocumentPayload {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  sizeBytes: number;
  chunkCount: number;
  answerPreview: string;
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
  /** Effective KB retrieval query (may differ from raw user text). */
  kbQuery?: string;
  /** Section titles from chunks passed to the model after policy filter. */
  retrievedSectionTitles?: string[];
  /** Relevance scores for chunks passed to the model (same order). */
  topScores?: number[];
  /** Distinct document ids for chunks passed to the model. */
  documentIds?: string[];
}
