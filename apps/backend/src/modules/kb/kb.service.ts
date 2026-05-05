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
import {
  buildRichTextChunkSpecs,
  classifyHeadingLines,
  type RichTextChunkSpec,
} from '../../lib/kb-section-chunking';
import {
  rankChunksByRelevance,
  rankChunksForKbSearch,
  normalizeKbSearchScores,
  buildSnippetAroundQuery,
  computeKbSearchHitPresentation,
  type ScorableChunk,
} from '../../lib/kb-retrieval-score';
import {
  KB_RICH_TEXT_SOURCE_METADATA_KEY,
  reconstructEditableNoteFromChunks,
} from '../../lib/kb-rich-text-source';
import { KB_VAULT_DELETE_HAS_DOCUMENTS_MSG, kbDuplicateVaultDisplayName } from './kb-vault-messages';

const DEFAULT_TOP_K = 5;
/** Default rows returned for KB search UI (client may display fewer). */
const KB_SEARCH_DEFAULT_TOP_K = 12;

function truncateSnippetToLines(snippet: string, maxLines: number, maxChars: number): string {
  const normalized = snippet.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let out = lines.slice(0, maxLines).join('\n').trim();
  if (out.length > maxChars) {
    out = `${out.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  return out;
}

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
    const { tenantId, conversationId, query: queryText, topK = DEFAULT_TOP_K, documentIdAllowlist } = query;

    const docScope =
      documentIdAllowlist === undefined
        ? 'all_ready'
        : documentIdAllowlist === null
          ? 'null'
          : documentIdAllowlist.length === 0
            ? 'no_documents'
            : `allowlist(${documentIdAllowlist.length})`;
    this.logger.debug(
      `KB retrieval started: tenant=${tenantId}, conversation=${conversationId}, topK=${topK} docScope=${docScope}`,
    );

    // Load READY chunks (optionally restricted to assistant profile vault access)
    const chunks = await this.loadTenantChunks(tenantId, documentIdAllowlist, undefined);
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
   *
   * Behavioural contract:
   * - Strict matches are normalised to [0..1] with the leader at 1.
   * - When no strict matches exist, hits are still returned (best-effort) but capped at 0.2 so
   *   the UI never shows "100%" on a weak result.
   */
  async searchKnowledge(params: {
    tenantId: string;
    query: string;
    topK?: number;
    intentHint?: string;
    vaultId?: string;
  }): Promise<KbSearchResponse> {
    const topK = Math.min(50, Math.max(1, Math.floor(params.topK ?? KB_SEARCH_DEFAULT_TOP_K)));
    const chunks = await this.loadTenantChunks(params.tenantId, undefined, params.vaultId?.trim() || undefined);
    const ranked = rankChunksForKbSearch(params.query, chunks as ScorableChunk[], {
      intentHint: params.intentHint,
      topK,
    });
    const normalized = normalizeKbSearchScores(ranked);
    const hits: KbSearchHit[] = normalized.map(({ chunk, score, bestEffort }) => {
      const st = chunk.metadata['sectionTitle'];
      const sectionTitle = typeof st === 'string' && st.trim() ? st.trim() : null;
      const updatedAtRaw = chunk.metadata['documentUpdatedAt'] ?? chunk.metadata['updatedAt'];
      const updatedAt =
        typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw : null;
      const presentation = computeKbSearchHitPresentation({
        query: params.query,
        chunk,
        normalizedScore: score,
        bestEffort,
      });
      const rawSnippet = buildSnippetAroundQuery(chunk.content, params.query, 300, sectionTitle);
      return {
        documentId: chunk.documentId,
        documentTitle: chunk.title,
        sectionTitle,
        snippet: truncateSnippetToLines(rawSnippet, 4, 380),
        score,
        bestEffort: presentation.bestEffort,
        chunkId: chunk.id,
        kind: chunk.source,
        updatedAt,
        relevanceLabel: presentation.relevanceLabel,
        scorePercent: presentation.scorePercent,
      };
    });

    const topSectionTitles = hits.slice(0, 5).map(h => h.sectionTitle ?? '(intro)');
    const topScores = hits.slice(0, 5).map(h => Number(h.score.toFixed(3)));
    const topDocIds = [...new Set(hits.slice(0, 5).map(h => h.documentId))];
    this.logger.log(
      `KB search: tenant=${params.tenantId} query=${JSON.stringify(params.query)} ` +
        `intentHint=${params.intentHint ?? 'n/a'} candidateCount=${chunks.length} returnedCount=${hits.length} ` +
        `topSectionTitles=${JSON.stringify(topSectionTitles)} topScores=${JSON.stringify(topScores)} ` +
        `topDocumentIds=${JSON.stringify(topDocIds)}`,
    );

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
      .select('id, title, source, status, created_at, updated_at, metadata, mime_type, size, vault_id')
      .eq('tenant_id', tenantId);
    if (!opts?.includeAllStatuses) {
      q = q.eq('status', 'READY');
    }
    const { data, error } = await q.order('created_at', { ascending: false });

    if (error || !data) return [];

    // Fetch chunk counts per document
    const docIds = data.map(d => d.id);
    const vaultIds = [
      ...new Set(
        data
          .map(d => (d as { vault_id?: string | null }).vault_id)
          .filter((x): x is string => typeof x === 'string' && x.length > 0),
      ),
    ];
    const vaultNameById: Record<string, string> = {};
    if (vaultIds.length > 0) {
      const { data: vaultRows } = await this.supabase
        .from('knowledge_vaults')
        .select('id, name')
        .in('id', vaultIds);
      for (const v of vaultRows ?? []) {
        vaultNameById[v.id as string] = String(v.name ?? '');
      }
    }

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
        vault_id?: string | null;
      };
      const vid = row.vault_id ?? null;

      return {
        id: d.id,
        title: d.title,
        source: d.source,
        status: d.status,
        documentKind: kind,
        vaultId: vid,
        vaultName: vid ? vaultNameById[vid] ?? null : null,
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
    const strip = new Set([
      'embedding',
      'vector',
      'vectors',
      'embeddings',
      KB_RICH_TEXT_SOURCE_METADATA_KEY.toLowerCase(),
    ]);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metadata ?? {})) {
      if (strip.has(k.toLowerCase())) continue;
      out[k] = v;
    }
    return out;
  }

  private async resolveVaultIdForNewDocument(tenantId: string, requestedVaultId?: string | null): Promise<string> {
    const want = requestedVaultId?.trim();
    if (!want) return this.ensureDefaultVaultForTenant(tenantId);
    const { data, error } = await this.supabase
      .from('knowledge_vaults')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', want)
      .maybeSingle();
    if (error || !data?.id) return this.ensureDefaultVaultForTenant(tenantId);
    return data.id as string;
  }

  async createFaq(tenantId: string, question: string, answer: string, requestedVaultId?: string): Promise<{ id: string }> {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) throw new Error('question and answer required');
    const vaultId = await this.resolveVaultIdForNewDocument(tenantId, requestedVaultId);
    const title = `FAQ: ${q.slice(0, 200)}`;
    const docId = randomUUID();
    const now = new Date().toISOString();
    const { data: doc, error: de } = await this.supabase
      .from('knowledge_documents')
      .insert({
        id: docId,
        tenant_id: tenantId,
        vault_id: vaultId,
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

  async createRichText(tenantId: string, title: string, content: string, requestedVaultId?: string): Promise<{ id: string }> {
    const t = title.trim();
    const c = content.trim();
    if (!t || !c) throw new Error('title and content required');
    const vaultId = await this.resolveVaultIdForNewDocument(tenantId, requestedVaultId);
    const docId = randomUUID();
    const now = new Date().toISOString();
    const { data: doc, error: de } = await this.supabase
      .from('knowledge_documents')
      .insert({
        id: docId,
        tenant_id: tenantId,
        vault_id: vaultId,
        title: t,
        source: 'rich_text',
        mime_type: 'text/plain',
        size: c.length,
        status: 'READY',
        metadata: { documentKind: 'rich_text', [KB_RICH_TEXT_SOURCE_METADATA_KEY]: c },
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

    const sectionTitlesLog = [
      ...new Set(
        specs.map(s => {
          const st = s.metadata['sectionTitle'];
          return typeof st === 'string' && st.trim() ? st.trim() : '(intro)';
        }),
      ),
    ];
    this.logger.log(
      `KB rich CREATE doc=${doc.id} tenant=${tenantId} titleLen=${t.length} contentLen=${c.length} ` +
        `chunkCount=${specs.length} sectionTitles=${JSON.stringify(sectionTitlesLog)}`,
    );
    if (specs.length <= 1 && c.length > 600) {
      this.logger.warn(
        `section_chunking_suspicious=true doc=${doc.id} tenant=${tenantId} ` +
          `contentLen=${c.length} chunkCount=${specs.length} sectionTitles=${JSON.stringify(sectionTitlesLog)}`,
      );
      const sample = classifyHeadingLines(c, 20);
      for (const row of sample) {
        this.logger.warn(
          `chunk_diag line=${row.lineNum} rawLen=${row.rawLen} ` +
            `isHeading=${row.isHeading} reason=${row.headingReason} ` +
            `preview=${JSON.stringify(row.trimmedPreview)}`,
        );
      }
    }
    return { id: doc.id };
  }

  async getRichNoteSourceForEdit(
    tenantId: string,
    documentId: string,
  ): Promise<{
    id: string;
    title: string;
    content: string;
    updatedAt: string;
    status: string;
    chunkCount: number;
  } | null> {
    const { data: doc, error } = await this.supabase
      .from('knowledge_documents')
      .select('id, tenant_id, title, source, status, created_at, updated_at, metadata')
      .eq('id', documentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !doc) return null;

    const kind = inferDocumentKind(doc.source as string, doc.metadata);
    if (kind === 'faq' || kind === 'file') return null;

    const meta =
      doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
        ? (doc.metadata as Record<string, unknown>)
        : {};
    const stored =
      typeof meta[KB_RICH_TEXT_SOURCE_METADATA_KEY] === 'string'
        ? (meta[KB_RICH_TEXT_SOURCE_METADATA_KEY] as string)
        : '';
    let content = stored.trim();
    if (!content) {
      const chunks = await this.getChunks(documentId);
      content = reconstructEditableNoteFromChunks(
        chunks.map(c => ({
          id: c.id,
          content: c.content,
          metadata: c.metadata,
          createdAt: c.createdAt ?? null,
        })),
      );
    }

    const { count, error: cErr } = await this.supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    if (cErr) {
      this.logger.warn(`getRichNoteSourceForEdit: chunk count failed doc=${documentId}: ${cErr.message}`);
    }

    const row = doc as { title: string; status: string; updated_at?: string | null; created_at?: string };
    const updatedAt = (row.updated_at && String(row.updated_at)) || String(row.created_at ?? '');

    return {
      id: documentId,
      title: row.title,
      content,
      updatedAt,
      status: row.status,
      chunkCount: count ?? 0,
    };
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
      .select('id, source, metadata, updated_at')
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
    const prevUpdatedAt = (doc as { updated_at?: string | null }).updated_at ?? null;
    const now = new Date().toISOString();

    const { count: oldChunkCount, error: ocErr } = await this.supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    if (ocErr) {
      this.logger.warn(`updateRichText: old chunk count query failed doc=${documentId}: ${ocErr.message}`);
    }

    const { error: ue } = await this.supabase
      .from('knowledge_documents')
      .update({
        title: t,
        size: c.length,
        metadata: {
          ...prevMeta,
          documentKind: prevMeta['documentKind'] ?? kind,
          [KB_RICH_TEXT_SOURCE_METADATA_KEY]: c,
        },
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

    const sectionTitlesLog = [
      ...new Set(
        specs.map(s => {
          const st = s.metadata['sectionTitle'];
          return typeof st === 'string' && st.trim() ? st.trim() : '(intro)';
        }),
      ),
    ];
    this.logger.log(
      `KB rich PATCH doc=${documentId} tenant=${tenantId} titleLen=${t.length} contentLen=${c.length} ` +
        `oldChunks=${oldChunkCount ?? 0} newChunks=${specs.length} sectionTitles=${JSON.stringify(sectionTitlesLog)} ` +
        `updatedAtBefore=${JSON.stringify(prevUpdatedAt)} updatedAtAfter=${JSON.stringify(now)}`,
    );

    // Heuristic warning: a long note that produced only 1 chunk almost certainly indicates that
    // the section detector failed (no headings recognised) — surface this so we can investigate.
    if (specs.length <= 1 && c.length > 600) {
      this.logger.warn(
        `section_chunking_suspicious=true doc=${documentId} tenant=${tenantId} ` +
          `contentLen=${c.length} chunkCount=${specs.length} sectionTitles=${JSON.stringify(sectionTitlesLog)}`,
      );
      // Diagnostic: print the first 20 non-empty lines + classification so we can see WHY
      // headings are not being detected (no full body, just trimmed previews ≤80 chars).
      const sample = classifyHeadingLines(c, 20);
      for (const row of sample) {
        this.logger.warn(
          `chunk_diag line=${row.lineNum} rawLen=${row.rawLen} ` +
            `isHeading=${row.isHeading} reason=${row.headingReason} ` +
            `preview=${JSON.stringify(row.trimmedPreview)}`,
        );
      }
    }

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
    requestedVaultId?: string,
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
    const vaultId = await this.resolveVaultIdForNewDocument(tenantId, requestedVaultId);
    const docId = randomUUID();
    const now = new Date().toISOString();
    let metadata: Record<string, unknown> = { fileName, mime, documentKind: 'file' };

    const { data: doc, error: de } = await this.supabase
      .from('knowledge_documents')
      .insert({
        id: docId,
        tenant_id: tenantId,
        vault_id: vaultId,
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
    createdAt?: string | null;
  }>> {
    const { data, error } = await this.supabase
      .from('knowledge_chunks')
      .select('id, content, token_count, metadata, created_at')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(c => ({
      id: c.id,
      content: c.content,
      tokenCount: c.token_count,
      metadata: (c.metadata as Record<string, unknown>) ?? {},
      createdAt: (c as { created_at?: string | null }).created_at ?? null,
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
    createdAt?: string | null;
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
      const vaultId = await this.ensureDefaultVaultForTenant(tenantId);
      const { data: newDoc, error: newDocError } = await this.supabase
        .from('knowledge_documents')
        .insert({
          tenant_id: tenantId,
          vault_id: vaultId,
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

  /**
   * Ensures the tenant has at least one knowledge vault (creates "General Knowledge" if needed).
   * New documents must reference a vault_id.
   */
  async ensureDefaultVaultForTenant(tenantId: string): Promise<string> {
    const { data: def } = await this.supabase
      .from('knowledge_vaults')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .maybeSingle();
    if (def?.id) return def.id as string;

    const { data: anyV } = await this.supabase
      .from('knowledge_vaults')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle();
    if (anyV?.id) return anyV.id as string;

    const id = randomUUID();
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('knowledge_vaults').insert({
      id,
      tenant_id: tenantId,
      name: 'General Knowledge',
      description: null,
      is_default: true,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(`Failed to create default vault: ${error.message}`);
    return id;
  }

  async listVaults(tenantId: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      isDefault: boolean;
      documentCount: number;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const { data: vaults, error } = await this.supabase
      .from('knowledge_vaults')
      .select('id, name, description, is_default, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error || !vaults?.length) return [];

    const { data: counts } = await this.supabase
      .from('knowledge_documents')
      .select('vault_id')
      .eq('tenant_id', tenantId);
    const countByVault: Record<string, number> = {};
    for (const r of counts ?? []) {
      const vid = r['vault_id'] as string | undefined;
      if (vid) countByVault[vid] = (countByVault[vid] ?? 0) + 1;
    }

    return vaults.map(v => ({
      id: v.id as string,
      name: v.name as string,
      description: (v.description as string | null) ?? null,
      isDefault: Boolean(v['is_default']),
      documentCount: countByVault[v.id as string] ?? 0,
      createdAt: String(v['created_at'] ?? ''),
      updatedAt: String(v['updated_at'] ?? ''),
    }));
  }

  async createVault(
    tenantId: string,
    name: string,
    description?: string | null,
  ): Promise<{ id: string }> {
    const n = name.trim();
    if (!n) throw new Error('Vault name is required');
    const now = new Date().toISOString();
    const id = randomUUID();
    const { error } = await this.supabase.from('knowledge_vaults').insert({
      id,
      tenant_id: tenantId,
      name: n,
      description: description?.trim() || null,
      is_default: false,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
    return { id };
  }

  async updateVault(
    tenantId: string,
    vaultId: string,
    body: { name?: string; description?: string | null },
  ): Promise<{ ok: true }> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) {
      const n = body.name.trim();
      if (!n) throw new Error('Vault name is required');
      updates['name'] = n;
    }
    if (body.description !== undefined) {
      updates['description'] = body.description === null || body.description === '' ? null : body.description.trim();
    }
    const { error } = await this.supabase
      .from('knowledge_vaults')
      .update(updates)
      .eq('id', vaultId)
      .eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  async deleteVault(
    tenantId: string,
    vaultId: string,
    _opts?: { reassignToVaultId?: string },
  ): Promise<{ ok: true }> {
    const { count, error: cErr } = await this.supabase
      .from('knowledge_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('vault_id', vaultId);
    if (cErr) throw new Error(cErr.message);
    const n = count ?? 0;
    if (n > 0) {
      throw new Error(KB_VAULT_DELETE_HAS_DOCUMENTS_MSG);
    }
    const { data: vrow } = await this.supabase
      .from('knowledge_vaults')
      .select('is_default')
      .eq('id', vaultId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (vrow?.['is_default']) {
      throw new Error('Cannot delete the default vault for this workspace.');
    }
    const { error: de } = await this.supabase.from('knowledge_vaults').delete().eq('id', vaultId).eq('tenant_id', tenantId);
    if (de) throw new Error(de.message);
    return { ok: true };
  }

  /**
   * Duplicate vault metadata only (empty vault). Name becomes "{original} copy".
   * Knowledge items are not copied.
   */
  async duplicateVault(tenantId: string, sourceVaultId: string): Promise<{ id: string }> {
    const { data: src, error: se } = await this.supabase
      .from('knowledge_vaults')
      .select('id, name, description')
      .eq('tenant_id', tenantId)
      .eq('id', sourceVaultId)
      .maybeSingle();
    if (se || !src?.id) throw new Error('Vault not found');

    const newName = kbDuplicateVaultDisplayName(String(src.name ?? 'Vault'));
    const now = new Date().toISOString();
    const id = randomUUID();
    const { error } = await this.supabase.from('knowledge_vaults').insert({
      id,
      tenant_id: tenantId,
      name: newName,
      description: src.description === null || src.description === undefined ? null : String(src.description),
      is_default: false,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
    return { id };
  }

  async setDocumentVault(tenantId: string, documentId: string, vaultId: string): Promise<{ ok: true }> {
    const { error } = await this.supabase
      .from('knowledge_documents')
      .update({ vault_id: vaultId, updated_at: new Date().toISOString() })
      .eq('id', documentId)
      .eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  private async loadTenantChunks(
    tenantId: string,
    documentIdAllowlist?: string[] | null,
    vaultId?: string | null,
  ): Promise<
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
    let docQuery = this.supabase
      .from('knowledge_documents')
      .select('id, title, source, updated_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'READY');

    const v = vaultId?.trim();
    if (v) {
      docQuery = docQuery.eq('vault_id', v);
    }

    if (documentIdAllowlist !== undefined && documentIdAllowlist !== null) {
      if (documentIdAllowlist.length === 0) return [];
      docQuery = docQuery.in('id', documentIdAllowlist);
    }

    const { data: docs, error: dErr } = await docQuery;

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
