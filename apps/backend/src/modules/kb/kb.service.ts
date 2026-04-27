// KB (Knowledge Base) service — retrieval + document management
// Two-stage retrieval: keyword fallback now, vector-ready interface for pgvector later.
// All operations are tenant-scoped.

import { randomUUID } from 'node:crypto';
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

function inferDocumentKind(
  source: string,
  metadata: unknown,
): string {
  const m = metadata as Record<string, unknown> | null | undefined;
  if (m && typeof m['documentKind'] === 'string' && m['documentKind'].trim() !== '') {
    return m['documentKind']!.trim();
  }
  const s = (source || '').toLowerCase();
  if (s === 'faq') return 'faq';
  if (s === 'rich_text' || s === 'rich') return 'rich_text';
  if (s.includes('pdf') || s.includes('word') || s === 'file') return 'file';
  return 'manual';
}

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
  async listDocuments(
    tenantId: string,
    opts?: { includeAllStatuses?: boolean },
  ): Promise<Array<{
    id: string;
    title: string;
    source: string;
    status: string;
    documentKind: string;
    chunkCount: number;
    createdAt: string;
    /** First chunk text — used for FAQ / note preview in UI */
    answerPreview?: string;
    /** FAQ question from metadata or title */
    faqQuestion?: string;
  }>> {
    // Omit `document_kind` from the select list so PostgREST works even if its schema cache
    // lags after migrations; we infer kind from `source` + `metadata.documentKind`.
    let q = this.supabase
      .from('knowledge_documents')
      .select('id, title, source, status, created_at, metadata')
      .eq('tenant_id', tenantId);
    if (!opts?.includeAllStatuses) {
      q = q.eq('status', 'READY');
    }
    const { data, error } = await q.order('created_at', { ascending: false });

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

    const { data: chunkBodies } = await this.supabase
      .from('knowledge_chunks')
      .select('document_id, content, id')
      .in('document_id', docIds)
      .order('id', { ascending: true });

    const previewByDoc: Record<string, string> = {};
    for (const row of chunkBodies ?? []) {
      const did = row.document_id as string;
      if (previewByDoc[did] === undefined && typeof row.content === 'string') {
        previewByDoc[did] = row.content;
      }
    }

    return data.map(d => {
      const meta = (d as { metadata?: Record<string, unknown> }).metadata ?? {};
      const kind = inferDocumentKind(d.source, meta);
      const qMeta = typeof meta['question'] === 'string' ? meta['question'].trim() : '';
      const firstChunk = previewByDoc[d.id] ?? '';
      const faqQuestion =
        kind === 'faq'
          ? (qMeta || d.title.replace(/^FAQ:\s*/i, '').trim() || d.title)
          : undefined;
      const answerPreview =
        kind === 'faq' || kind === 'rich_text' ? firstChunk.slice(0, 500) : undefined;

      return {
        id: d.id,
        title: d.title,
        source: d.source,
        status: d.status,
        documentKind: kind,
        chunkCount: countMap[d.id] ?? 0,
        createdAt: d.created_at,
        ...(faqQuestion !== undefined ? { faqQuestion } : {}),
        ...(answerPreview !== undefined && answerPreview.length > 0
          ? { answerPreview }
          : {}),
      };
    });
  }

  async createFaq(tenantId: string, question: string, answer: string): Promise<{ id: string }> {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) throw new Error('question and answer required');
    const title = `FAQ: ${q.slice(0, 200)}`;
    const docId = randomUUID();
    const now = new Date().toISOString();
    const { data: doc, error: de } = await this.supabase
      .from('knowledge_documents')
      .insert({
        id: docId,
        tenant_id: tenantId,
        title,
        source: 'faq',
        mime_type: 'text/plain',
        size: a.length,
        status: 'READY',
        metadata: { question: q, documentKind: 'faq' },
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (de || !doc) throw new Error(`FAQ doc: ${de?.message}`);
    const chunkId = randomUUID();
    const { error: ce } = await this.supabase.from('knowledge_chunks').insert({
      id: chunkId,
      document_id: doc.id,
      content: a,
      token_count: Math.ceil(a.length / 4),
      metadata: { kind: 'faq' },
    });
    if (ce) throw new Error(`FAQ chunk: ${ce.message}`);
    return { id: doc.id };
  }

  async createRichText(tenantId: string, title: string, content: string): Promise<{ id: string }> {
    const t = title.trim();
    const c = content.trim();
    if (!t || !c) throw new Error('title and content required');
    const docId = randomUUID();
    const now = new Date().toISOString();
    const { data: doc, error: de } = await this.supabase
      .from('knowledge_documents')
      .insert({
        id: docId,
        tenant_id: tenantId,
        title: t,
        source: 'rich_text',
        mime_type: 'text/plain',
        size: c.length,
        status: 'READY',
        metadata: { documentKind: 'rich_text' },
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (de || !doc) throw new Error(`Rich doc: ${de?.message}`);
    const chunkId = randomUUID();
    const { error: ce } = await this.supabase.from('knowledge_chunks').insert({
      id: chunkId,
      document_id: doc.id,
      content: c,
      token_count: Math.ceil(c.length / 4),
      metadata: { kind: 'rich_text' },
    });
    if (ce) throw new Error(`Rich chunk: ${ce.message}`);
    return { id: doc.id };
  }

  async createFileFromBuffer(
    tenantId: string,
    fileName: string,
    buffer: Buffer,
    mime: string,
  ): Promise<{ id: string; status: string }> {
    const m = (mime || '').toLowerCase();
    let text = '';
    if (m === 'text/plain' || m === 'text/markdown' || m.startsWith('text/')) {
      text = buffer.toString('utf8');
    } else if (m === 'application/pdf') {
      throw new Error('PDF extraction is not enabled on this server; use .txt or contact ops to add a worker');
    } else if (
      m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      m === 'application/msword'
    ) {
      throw new Error('Word extraction is not enabled; use .txt for now');
    } else {
      text = buffer.toString('utf8');
    }
    if (!text.trim()) throw new Error('Empty or unsupported file content');
    const docId = randomUUID();
    const now = new Date().toISOString();
    const { data: doc, error: de } = await this.supabase
      .from('knowledge_documents')
      .insert({
        id: docId,
        tenant_id: tenantId,
        title: fileName,
        source: m || 'file',
        mime_type: mime || 'application/octet-stream',
        size: buffer.length,
        status: 'READY',
        metadata: { fileName, mime, documentKind: 'file' },
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (de || !doc) throw new Error(`File doc: ${de?.message}`);
    const chunkId = randomUUID();
    const { error: ce } = await this.supabase.from('knowledge_chunks').insert({
      id: chunkId,
      document_id: doc.id,
      content: text,
      token_count: Math.ceil(text.length / 4),
      metadata: { kind: 'file' },
    });
    if (ce) throw new Error(`File chunk: ${ce.message}`);
    return { id: doc.id, status: 'READY' };
  }

  async updateFaq(
    tenantId: string,
    documentId: string,
    question: string,
    answer: string,
  ): Promise<{ ok: true }> {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) throw new Error('question and answer required');

    const { data: doc, error: fe } = await this.supabase
      .from('knowledge_documents')
      .select('id, source, metadata')
      .eq('id', documentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (fe || !doc) throw new Error('Document not found');

    const kind = inferDocumentKind(doc.source, doc.metadata);
    if (kind !== 'faq' && String(doc.source).toLowerCase() !== 'faq') {
      throw new Error('Not an FAQ document');
    }

    const title = `FAQ: ${q.slice(0, 200)}`;
    const prevMeta =
      doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
        ? (doc.metadata as Record<string, unknown>)
        : {};
    const now = new Date().toISOString();

    const { error: ue } = await this.supabase
      .from('knowledge_documents')
      .update({
        title,
        size: a.length,
        metadata: { ...prevMeta, question: q, documentKind: 'faq' },
        updated_at: now,
      })
      .eq('id', documentId)
      .eq('tenant_id', tenantId);
    if (ue) throw new Error(ue.message);

    const { error: ce } = await this.supabase
      .from('knowledge_chunks')
      .update({
        content: a,
        token_count: Math.ceil(a.length / 4),
      })
      .eq('document_id', documentId);
    if (ce) throw new Error(ce.message);

    return { ok: true };
  }

  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    const { data: doc } = await this.supabase
      .from('knowledge_documents')
      .select('id')
      .eq('id', documentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!doc) throw new Error('Document not found');
    const { error } = await this.supabase.from('knowledge_documents').delete().eq('id', documentId);
    if (error) throw new Error(error.message);
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
   * Same as {@link getChunks}, but only if the document exists under the given tenant.
   * Used by HTTP to avoid leaking chunks across tenants when addressing by document id alone.
   */
  async getChunksForTenant(
    documentId: string,
    tenantId: string,
  ): Promise<Array<{
    id: string;
    content: string;
    tokenCount: number;
    metadata: Record<string, unknown>;
  }> | null> {
    const { data: doc, error } = await this.supabase
      .from('knowledge_documents')
      .select('id')
      .eq('id', documentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !doc) {
      return null;
    }

    return this.getChunks(documentId);
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
    // Two-step load: PostgREST embed filters on aliased `document.*` are unreliable in some clients;
    // we filter READY + tenant on `knowledge_documents` first, then load chunks.
    const { data: docs, error: dErr } = await this.supabase
      .from('knowledge_documents')
      .select('id, title, source')
      .eq('tenant_id', tenantId)
      .eq('status', 'READY');

    if (dErr) {
      this.logger.warn(`loadTenantChunks: documents failed: ${dErr.message}`);
      return [];
    }
    if (!docs?.length) return [];

    const docById: Record<string, { id: string; title: string; source: string }> = {};
    for (const d of docs) {
      docById[d.id] = { id: d.id, title: d.title, source: d.source };
    }
    const docIds = docs.map(d => d.id);

    const { data: rows, error: cErr } = await this.supabase
      .from('knowledge_chunks')
      .select('id, document_id, content, metadata')
      .in('document_id', docIds);

    if (cErr) {
      this.logger.warn(`loadTenantChunks: chunks failed: ${cErr.message}`);
      return [];
    }
    if (!rows) return [];

    return rows
      .map(row => {
        const doc = docById[row.document_id as string];
        if (!doc) return null;
        return {
          id: row.id,
          documentId: row.document_id,
          title: doc.title,
          source: doc.source,
          content: row.content,
          metadata: (row.metadata as Record<string, unknown>) ?? {},
        };
      })
      .filter(
        (x): x is {
          id: string;
          documentId: string;
          title: string;
          source: string;
          content: string;
          metadata: Record<string, unknown>;
        } => x != null,
      );
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
