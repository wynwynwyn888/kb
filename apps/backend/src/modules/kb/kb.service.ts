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
  KbSearchResponse,
  KbSearchHit,
  KbRichTextDocumentPayload,
} from './dto/retrieval.dto';
import { buildRichTextChunkSpecs, type RichTextChunkSpec } from '../../lib/kb-section-chunking';
import { rankChunksByRelevance, buildSnippetAroundQuery, type ScorableChunk } from '../../lib/kb-retrieval-score';

const DEFAULT_TOP_K = 5;

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
    const scored = this.keywordScore(queryText, chunks, topK, query.intentHint);
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
   * Tenant KB search for UI / diagnostics — returns compact hits with snippets (not full chunks).
   */
  async searchKnowledge(params: {
    tenantId: string;
    query: string;
    topK?: number;
    intentHint?: string;
  }): Promise<KbSearchResponse> {
    const topK = Math.min(50, Math.max(1, Math.floor(params.topK ?? DEFAULT_TOP_K)));
    const chunks = await this.loadTenantChunks(params.tenantId);
    const ranked = rankChunksByRelevance(params.query, chunks as ScorableChunk[], {
      intentHint: params.intentHint,
    });
    const top = ranked.slice(0, topK);
    const maxS = top[0]?.score ?? 1;
    const norm = maxS > 0 ? maxS : 1;
    const hits: KbSearchHit[] = top.map(({ chunk, score }) => {
      const st = chunk.metadata['sectionTitle'];
      const sectionTitle = typeof st === 'string' && st.trim() ? st.trim() : null;
      return {
        documentId: chunk.documentId,
        documentTitle: chunk.title,
        sectionTitle,
        snippet: buildSnippetAroundQuery(chunk.content, params.query, 240, sectionTitle),
        score: Math.min(1, Math.max(0, score / norm)),
        chunkId: chunk.id,
      };
    });
    return {
      query: params.query,
      hits,
      totalConsidered: chunks.length,
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
    updatedAt: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    /** True when an object-storage path exists for the uploaded bytes */
    originalDownloadable?: boolean;
    /** First chunk text — used for FAQ / note / file preview in UI */
    answerPreview?: string;
    /** FAQ question from metadata or title */
    faqQuestion?: string;
  }>> {
    // Omit `document_kind` from the select list so PostgREST works even if its schema cache
    // lags after migrations; we infer kind from `source` + `metadata.documentKind`.
    let q = this.supabase
      .from('knowledge_documents')
      .select('id, title, source, status, created_at, updated_at, metadata, mime_type, size')
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
      .select('document_id, content, id, metadata')
      .in('document_id', docIds)
      .order('id', { ascending: true });

    const chunksByDoc: Record<string, Array<{ content: string; metadata: Record<string, unknown> }>> = {};
    for (const row of chunkBodies ?? []) {
      const did = row.document_id as string;
      if (!chunksByDoc[did]) chunksByDoc[did] = [];
      chunksByDoc[did].push({
        content: typeof row.content === 'string' ? row.content : '',
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      });
    }
    const previewByDoc: Record<string, string> = {};
    for (const did of Object.keys(chunksByDoc)) {
      previewByDoc[did] = this.buildAnswerPreviewForList(chunksByDoc[did]!);
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
      const previewKinds = ['faq', 'rich_text', 'file', 'manual'];
      const answerPreview =
        previewKinds.includes(kind) && firstChunk ? firstChunk.slice(0, 500) : undefined;

      const storagePath =
        typeof meta['originalStoragePath'] === 'string' ? meta['originalStoragePath'].trim() : '';
      const originalDownloadable = kind === 'file' && storagePath.length > 0;

      const row = d as {
        created_at: string;
        updated_at?: string | null;
        mime_type?: string | null;
        size?: number | null;
      };

      return {
        id: d.id,
        title: d.title,
        source: d.source,
        status: d.status,
        documentKind: kind,
        chunkCount: countMap[d.id] ?? 0,
        createdAt: row.created_at,
        updatedAt: (row.updated_at && String(row.updated_at)) || row.created_at,
        ...(kind === 'file'
          ? {
              mimeType: row.mime_type ?? null,
              sizeBytes: typeof row.size === 'number' ? row.size : null,
              originalDownloadable,
            }
          : {}),
        ...(faqQuestion !== undefined ? { faqQuestion } : {}),
        ...(answerPreview !== undefined && answerPreview.length > 0
          ? { answerPreview }
          : {}),
      };
    });
  }

  /** Strip vector-like fields before returning chunk metadata to clients. */
  sanitizeChunkMetadataForClient(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const strip = new Set(['embedding', 'vector', 'vectors', 'embeddings']);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metadata ?? {})) {
      if (strip.has(k.toLowerCase())) continue;
      out[k] = v;
    }
    return out;
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
    const specs = buildRichTextChunkSpecs({
      fullText: c,
      documentTitle: t,
      documentUpdatedAtIso: now,
    });
    await this.insertChunkSpecsForDocument(doc.id, specs, 'rich_text');
    return { id: doc.id };
  }

  async updateRichText(
    tenantId: string,
    documentId: string,
    title: string,
    content: string,
  ): Promise<{ document: KbRichTextDocumentPayload }> {
    const t = title.trim();
    const c = content.trim();
    if (!t || !c) throw new Error('title and content required');

    const { data: doc, error: fe } = await this.supabase
      .from('knowledge_documents')
      .select('id, source, metadata')
      .eq('id', documentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (fe || !doc) throw new Error('Document not found');

    const kind = inferDocumentKind(doc.source, doc.metadata);
    if (kind === 'faq' || kind === 'file') {
      throw new Error('Not a note document');
    }

    const prevMeta =
      doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
        ? (doc.metadata as Record<string, unknown>)
        : {};
    const now = new Date().toISOString();

    const { error: ue } = await this.supabase
      .from('knowledge_documents')
      .update({
        title: t,
        size: c.length,
        metadata: { ...prevMeta, documentKind: prevMeta['documentKind'] ?? kind },
        updated_at: now,
      })
      .eq('id', documentId)
      .eq('tenant_id', tenantId);
    if (ue) throw new Error(ue.message);

    const { error: delE } = await this.supabase
      .from('knowledge_chunks')
      .delete()
      .eq('document_id', documentId);
    if (delE) throw new Error(delE.message);

    const kindLabel = kind === 'manual' ? 'manual' : 'rich_text';
    const specs = buildRichTextChunkSpecs({
      fullText: c,
      documentTitle: t,
      documentUpdatedAtIso: now,
    });
    await this.insertChunkSpecsForDocument(documentId, specs, kindLabel);

    const { data: rows, error: chErr } = await this.supabase
      .from('knowledge_chunks')
      .select('content, metadata')
      .eq('document_id', documentId);
    if (chErr) throw new Error(chErr.message);
    const preview = this.buildAnswerPreviewForList(
      (rows ?? []).map(r => ({
        content: String(r.content ?? ''),
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      })),
    );
    const { count, error: ctErr } = await this.supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    if (ctErr) throw new Error(ctErr.message);

    const { data: docRow, error: re } = await this.supabase
      .from('knowledge_documents')
      .select('id, title, status, updated_at, size')
      .eq('id', documentId)
      .eq('tenant_id', tenantId)
      .single();
    if (re || !docRow) throw new Error(re?.message ?? 'document reload failed');

    const dr = docRow as { id: string; title: string; status: string; updated_at: string; size: number };

    return {
      document: {
        id: dr.id,
        title: dr.title,
        status: dr.status,
        updatedAt: dr.updated_at,
        sizeBytes: dr.size,
        chunkCount: count ?? specs.length,
        answerPreview: preview,
      },
    };
  }

  /**
   * Return original upload bytes when `metadata.originalStoragePath` is set and the object exists.
   */
  async getOriginalFileForDownload(
    tenantId: string,
    documentId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
    const { data: doc, error } = await this.supabase
      .from('knowledge_documents')
      .select('id, tenant_id, title, source, mime_type, metadata')
      .eq('id', documentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !doc) return null;

    const kind = inferDocumentKind(doc.source as string, doc.metadata);
    if (kind !== 'file') return null;

    const meta =
      doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
        ? (doc.metadata as Record<string, unknown>)
        : {};
    const path = typeof meta['originalStoragePath'] === 'string' ? meta['originalStoragePath'].trim() : '';
    if (!path) return null;

    const bucket =
      (typeof meta['originalStorageBucket'] === 'string' && meta['originalStorageBucket'].trim()) ||
      process.env['KB_ORIGINALS_BUCKET']?.trim() ||
      'kb-originals';

    const { data: blob, error: dlErr } = await this.supabase.storage.from(bucket).download(path);
    if (dlErr || !blob) {
      this.logger.warn(`KB original download failed doc=${documentId}: ${dlErr?.message ?? 'no blob'}`);
      return null;
    }

    const arr = await blob.arrayBuffer();
    const fileLabel =
      (typeof meta['originalFileName'] === 'string' && meta['originalFileName'].trim()) ||
      (typeof meta['fileName'] === 'string' && meta['fileName'].trim()) ||
      (doc.title as string) ||
      'download';

    return {
      buffer: Buffer.from(arr),
      mimeType: (doc.mime_type as string) || 'application/octet-stream',
      filename: fileLabel,
    };
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
    let metadata: Record<string, unknown> = { fileName, mime, documentKind: 'file' };

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
        metadata,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (de || !doc) throw new Error(`File doc: ${de?.message}`);

    const bucket = process.env['KB_ORIGINALS_BUCKET']?.trim();
    if (bucket && buffer.length > 0) {
      const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'upload.bin';
      const storagePath = `${tenantId}/${doc.id}/${safe}`;
      const { error: upErr } = await this.supabase.storage.from(bucket).upload(storagePath, buffer, {
        contentType: mime || 'application/octet-stream',
        upsert: true,
      });
      if (!upErr) {
        metadata = {
          ...metadata,
          originalStoragePath: storagePath,
          originalStorageBucket: bucket,
          originalFileName: fileName,
        };
        const { error: me } = await this.supabase
          .from('knowledge_documents')
          .update({ metadata })
          .eq('id', doc.id)
          .eq('tenant_id', tenantId);
        if (me) {
          this.logger.warn(`KB file metadata update after storage upload failed: ${me.message}`);
        }
      } else {
        this.logger.warn(`KB original file not stored (${bucket}): ${upErr.message}`);
      }
    }

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

  private buildAnswerPreviewForList(
    chunks: Array<{ content: string; metadata: Record<string, unknown> }>,
  ): string {
    if (!chunks.length) return '';
    const sorted = [...chunks].sort((a, b) => {
      const ia = Number(a.metadata['sectionIndex']);
      const ib = Number(b.metadata['sectionIndex']);
      const pa = Number(a.metadata['sectionPartIndex'] ?? 0);
      const pb = Number(b.metadata['sectionPartIndex'] ?? 0);
      const na = Number.isFinite(ia) ? ia : 0;
      const nb = Number.isFinite(ib) ? ib : 0;
      if (na !== nb) return na - nb;
      return pa - pb;
    });
    const first = sorted[0];
    if (!first?.content?.trim()) return '';
    const st =
      typeof first.metadata['sectionTitle'] === 'string' ? first.metadata['sectionTitle'].trim() : '';
    const lines = first.content.trim().split('\n');
    const head = lines.slice(0, 5).join('\n').slice(0, 480);
    return (st ? `${st}\n${head}` : head).trim();
  }

  private async insertChunkSpecsForDocument(
    documentId: string,
    specs: RichTextChunkSpec[],
    kindLabel: string,
  ): Promise<void> {
    if (specs.length === 0) return;
    const rows = specs.map(s => ({
      id: randomUUID(),
      document_id: documentId,
      content: s.content,
      token_count: s.tokenCount,
      metadata: { ...s.metadata, kind: kindLabel },
    }));
    const { error } = await this.supabase.from('knowledge_chunks').insert(rows);
    if (error) throw new Error(error.message);
  }

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
      .select('id, title, source, updated_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'READY');

    if (dErr) {
      this.logger.warn(`loadTenantChunks: documents failed: ${dErr.message}`);
      return [];
    }
    if (!docs?.length) return [];

    const docById: Record<string, { id: string; title: string; source: string; updatedAt: string | null }> = {};
    for (const d of docs) {
      docById[d.id] = {
        id: d.id,
        title: d.title,
        source: d.source,
        updatedAt: (d as { updated_at?: string }).updated_at ?? null,
      };
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
        const baseMeta = (row.metadata as Record<string, unknown>) ?? {};
        return {
          id: row.id,
          documentId: row.document_id,
          title: doc.title,
          source: doc.source,
          content: row.content,
          metadata: {
            ...baseMeta,
            ...(doc.updatedAt ? { documentUpdatedAt: doc.updatedAt } : {}),
          },
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
   * Keyword scoring with section/title/intent-aware ranking.
   */
  private keywordScore(
    query: string,
    chunks: Array<{
      id: string;
      documentId: string;
      title: string;
      source: string;
      content: string;
      metadata: Record<string, unknown>;
    }>,
    topK: number,
    intentHint?: string,
  ): RetrievalChunk[] {
    const scorable = chunks as ScorableChunk[];
    if (!query.trim()) {
      return scorable.slice(0, topK).map(c => this.toRetrievalChunk(c, 0));
    }
    const ranked = rankChunksByRelevance(query, scorable, { intentHint });
    if (ranked.length === 0) {
      return scorable.slice(0, topK).map(c => this.toRetrievalChunk(c, 0.02));
    }
    const top = ranked.slice(0, topK);
    const maxS = top[0]!.score;
    const norm = maxS > 0 ? maxS : 1;
    return top.map(({ chunk, score }) => this.toRetrievalChunk(chunk, Math.min(1, Math.max(0, score / norm))));
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

}
