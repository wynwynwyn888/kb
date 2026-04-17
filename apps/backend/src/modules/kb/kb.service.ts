// KB (Knowledge Base) service — retrieval + document management
// Two-stage retrieval: keyword fallback now, vector-ready interface for pgvector later.
// All operations are tenant-scoped.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import type {
  RetrievalQuery,
  RetrievalChunk,
  RetrievalResult,
  RetrievalMeta,
} from './dto/retrieval.dto';

const DEFAULT_TOP_K = 5;
const KEYWORD_WINDOW = 3; // n-gram window for keyword matching

@Injectable()
export class KbService {
  private readonly logger = new Logger(KbService.name);
  private readonly supabase = getSupabaseService();

  /**
   * Retrieve relevant KB chunks for a tenant query.
   *
   * Strategy:
   * - STAGE 1 (keyword): Simple n-gram + TF-like scoring on plain text content.
   *   Activates when no pgvector embedding is available or as fallback.
   * - STAGE 2 (vector): Interface prepared — activates when chunks have embeddings.
   *   TODO: Swap to `pgvector` `cosine_distance` query when embedding column lands.
   *
   * In both stages, only `READY` documents are considered.
   */
  async retrieve(
    query: RetrievalQuery,
  ): Promise<RetrievalResult> {
    const { tenantId, conversationId, query: queryText, topK = DEFAULT_TOP_K } = query;

    this.logger.debug(
      `KB retrieval started: tenant=${tenantId}, conversation=${conversationId}, topK=${topK}`,
    );

    // Load all READY chunks for tenant (joined with document title/status)
    const chunks = await this.loadTenantChunks(tenantId);
    if (chunks.length === 0) {
      this.logger.debug(`KB retrieval: no chunks found for tenant=${tenantId}`);
      return {
        query: queryText,
        chunks: [],
        totalConsidered: 0,
        retrievalMode: 'keyword',
      };
    }

    const totalConsidered = chunks.length;

    // TODO: Stage 2 — vector search (activate when embeddings exist):
    // const hasVectors = chunks.some(c => c.embedding != null);
    // if (hasVectors) { return this.vectorSearch(query, chunks, topK); }

    // Stage 1 — keyword fallback scoring
    const scored = this.keywordScore(queryText, chunks);
    const top = scored.slice(0, topK);

    this.logger.debug(
      `KB retrieval completed: tenant=${tenantId}, considered=${totalConsidered}, returned=${top.length}, mode=keyword`,
    );

    return {
      query: queryText,
      chunks: top,
      totalConsidered,
      retrievalMode: 'keyword',
    };
  }

  /**
   * List all READY documents for a tenant.
   */
  async listDocuments(tenantId: string): Promise<Array<{
    id: string;
    title: string;
    source: string;
    status: string;
    chunkCount: number;
    createdAt: string;
  }>> {
    const { data, error } = await this.supabase
      .from('knowledge_documents')
      .select('id, title, source, status, created_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'READY')
      .order('created_at', { ascending: false });

    if (error || !data) return [];

    // Fetch chunk counts per document
    const docIds = data.map(d => d.id);
    const { data: chunks } = await this.supabase
      .from('knowledge_chunks')
      .select('document_id')
      .in('document_id', docIds);

    const countMap: Record<string, number> = {};
    for (const c of chunks ?? []) {
      countMap[c.document_id] = (countMap[c.document_id] ?? 0) + 1;
    }

    return data.map(d => ({
      id: d.id,
      title: d.title,
      source: d.source,
      status: d.status,
      chunkCount: countMap[d.id] ?? 0,
      createdAt: d.created_at,
    }));
  }

  /**
   * Get all chunks for a specific document.
   */
  async getChunks(documentId: string): Promise<Array<{
    id: string;
    content: string;
    tokenCount: number;
    metadata: Record<string, unknown>;
  }>> {
    const { data, error } = await this.supabase
      .from('knowledge_chunks')
      .select('id, content, token_count, metadata')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(c => ({
      id: c.id,
      content: c.content,
      tokenCount: c.token_count,
      metadata: (c.metadata as Record<string, unknown>) ?? {},
    }));
  }

  /**
   * Seed a manual FAQ chunk directly (for immediate retrieval testing).
   * This bypasses the full ingestion pipeline and is useful for demos/testing.
   */
  async seedManualChunk(tenantId: string, chunk: {
    title: string;
    content: string;
    source?: string;
  }): Promise<string> {
    // Find existing doc by tenant + title
    const { data: existing } = await this.supabase
      .from('knowledge_documents')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('title', chunk.title)
      .single();

    let docId: string;

    if (existing) {
      docId = existing.id;
      // Update existing doc to READY
      await this.supabase
        .from('knowledge_documents')
        .update({
          status: 'READY',
          size: chunk.content.length,
        })
        .eq('id', docId);
    } else {
      // Create new document
      const { data: newDoc, error: newDocError } = await this.supabase
        .from('knowledge_documents')
        .insert({
          tenant_id: tenantId,
          title: chunk.title,
          source: chunk.source ?? 'manual',
          mime_type: 'text/plain',
          size: chunk.content.length,
          status: 'READY',
        })
        .select('id')
        .single();

      if (newDocError || !newDoc) {
        throw new Error(`Failed to create manual document: ${newDocError?.message}`);
      }
      docId = newDoc.id;
    }

    // Find existing chunk by content
    const { data: existingChunk } = await this.supabase
      .from('knowledge_chunks')
      .select('id')
      .eq('document_id', docId)
      .eq('content', chunk.content)
      .single();

    if (existingChunk) {
      this.logger.log(`Manual KB chunk already exists: doc=${docId}, chunk=${existingChunk.id}`);
      return existingChunk.id;
    }

    // Insert new chunk
    const { data: chunkRec, error: chunkError } = await this.supabase
      .from('knowledge_chunks')
      .insert({
        document_id: docId,
        content: chunk.content,
        token_count: Math.ceil(chunk.content.length / 4),
        metadata: { seeded: true },
      })
      .select('id')
      .single();

    if (chunkError || !chunkRec) {
      throw new Error(`Failed to upsert chunk: ${chunkError?.message}`);
    }

    this.logger.log(`Manual KB chunk seeded: doc=${docId}, chunk=${chunkRec.id}`);
    return chunkRec.id;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async loadTenantChunks(tenantId: string): Promise<
    Array<{
      id: string;
      documentId: string;
      title: string;
      source: string;
      content: string;
      metadata: Record<string, unknown>;
    }>
  > {
    const { data, error } = await this.supabase
      .from('knowledge_chunks')
      .select(`
        id,
        document_id,
        content,
        metadata,
        document:knowledge_documents!inner(
          id,
          title,
          source,
          status
        )
      `)
      .eq('document.status', 'READY')
      .eq('document.tenant_id', tenantId);

    if (error || !data) return [];

    return data.map(row => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = row.document as any;
      return {
        id: row.id,
        documentId: row.document_id,
        title: doc.title as string,
        source: doc.source as string,
        content: row.content,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      };
    });
  }

  /**
   * Keyword scoring: n-gram overlap + length-normalized term frequency.
   * Returns chunks sorted by score descending.
   */
  private keywordScore(
    query: string,
    chunks: Array<{ id: string; documentId: string; title: string; source: string; content: string; metadata: Record<string, unknown> }>,
  ): RetrievalChunk[] {
    const queryTokens = this.tokenize(query);

    if (queryTokens.size === 0) {
      return chunks.map(c => this.toRetrievalChunk(c, 0));
    }

    const queryArr = [...queryTokens];

    const scored = chunks
      .map(chunk => {
        const contentTokens = this.tokenize(chunk.content);
        const titleTokens = this.tokenize(chunk.title);
        const allTokens = new Set([...contentTokens, ...titleTokens]);

        // Jaccard-like overlap
        const overlap = queryArr.filter(t => allTokens.has(t)).length;
        const union = new Set([...queryArr, ...allTokens]).size;
        const score = union > 0 ? overlap / union : 0;

        // Boost exact phrase matches
        const lowerQuery = query.toLowerCase();
        if (chunk.content.toLowerCase().includes(lowerQuery)) {
          return { chunk, score: score + 0.2 };
        }
        if (chunk.title.toLowerCase().includes(lowerQuery)) {
          return { chunk, score: score + 0.3 };
        }

        return { chunk, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map(r => this.toRetrievalChunk(r.chunk, r.score));
  }

  private toRetrievalChunk(
    chunk: { id: string; documentId: string; title: string; source: string; content: string; metadata: Record<string, unknown> },
    score: number,
  ): RetrievalChunk {
    return {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      title: chunk.title,
      source: chunk.source,
      relevanceScore: Math.min(1, Math.max(0, score)),
      metadata: chunk.metadata,
    };
  }

  /** Simple whitespace tokenizer + lowercasing */
  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .split(/\s+/)
        .map(t => t.replace(/[^\w]/g, ''))
        .filter(t => t.length >= 2),
    );
  }
}
