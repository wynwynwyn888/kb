// Tenant-limited KB embedding backfill core for staging/local RAG testing.
//
// Not wired into the backend runtime. The CLI script calls this explicitly.

import { prepareEmbeddingInputWithHash } from '../../../lib/kb-embedding-input';
import {
  OpenAiEmbeddingClient,
  type OpenAiEmbeddingClientConfig,
} from './openai-embedding.client';
import {
  resolveOpenAiEmbeddingCredentials,
  type SupabaseLikeClient,
} from './openai-key.resolver';
import {
  markKnowledgeChunkEmbeddingFailed,
  storeKnowledgeChunkEmbedding,
  type KbEmbeddingStoreResult,
  type SupabaseRpcLikeClient,
} from './kb-embedding-store';

export type BackfillEmbeddingStatus = 'pending' | 'failed' | 'skipped';

export interface BackfillQueryBuilder
  extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: unknown): BackfillQueryBuilder;
  in(column: string, values: unknown[]): BackfillQueryBuilder;
  is(column: string, value: unknown): BackfillQueryBuilder;
  limit(count: number): BackfillQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): BackfillQueryBuilder;
}

export interface BackfillSupabaseClient extends SupabaseRpcLikeClient {
  from(table: string): {
    select(columns: string): BackfillQueryBuilder;
  };
}

export interface BackfillKnowledgeChunk {
  id: string;
  content: string;
}

export interface KbEmbeddingBackfillOptions {
  tenantId: string;
  statuses?: BackfillEmbeddingStatus[];
  limit?: number;
  batchSize?: number;
  dryRun?: boolean;
  delayMs?: number;
}

export interface KbEmbeddingBackfillDeps {
  createEmbeddingClient?: (
    config: OpenAiEmbeddingClientConfig,
  ) => { embedTexts(texts: string[]): Promise<Array<{ index: number; embedding: number[] }>> };
  storeEmbedding?: typeof storeKnowledgeChunkEmbedding;
  markFailed?: typeof markKnowledgeChunkEmbeddingFailed;
  sleep?: (ms: number) => Promise<void>;
}

export interface KbEmbeddingBackfillSummary {
  ok: boolean;
  tenantId: string;
  scanned: number;
  embedded: number;
  failed: number;
  skipped: number;
  approximateTokens: number;
  reason?: string;
}

const DEFAULT_STATUSES: BackfillEmbeddingStatus[] = ['pending'];
const MAX_LIMIT = 5000;
const DEFAULT_LIMIT = 100;
const DEFAULT_BATCH_SIZE = 32;

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error ?? 'unknown error');
}

function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  const n = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function uniqueStatuses(statuses?: BackfillEmbeddingStatus[]): BackfillEmbeddingStatus[] {
  const input = statuses?.length ? statuses : DEFAULT_STATUSES;
  return [...new Set(input)].filter((s): s is BackfillEmbeddingStatus =>
    s === 'pending' || s === 'failed' || s === 'skipped',
  );
}

async function checkPgvectorAvailable(
  supabase: BackfillSupabaseClient,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const res = await supabase.rpc('check_pgvector_available', {});
  if (res.error) return { ok: false, reason: asErrorMessage(res.error) };
  if (res.data !== true) return { ok: false, reason: 'pgvector unavailable' };
  return { ok: true };
}

export async function loadReadyKnowledgeChunksForEmbedding(
  supabase: BackfillSupabaseClient,
  tenantId: string,
  statuses: BackfillEmbeddingStatus[],
  limit: number,
): Promise<{ ok: true; chunks: BackfillKnowledgeChunk[] } | { ok: false; reason: string }> {
  const docsRes = await supabase
    .from('knowledge_documents')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'READY')
    .order('updated_at', { ascending: false })
    .limit(10000);

  if (docsRes.error) return { ok: false, reason: asErrorMessage(docsRes.error) };

  const docs = Array.isArray(docsRes.data) ? docsRes.data : [];
  const documentIds = docs
    .map((row) => (row as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (documentIds.length === 0) return { ok: true, chunks: [] };

  const chunksRes = await supabase
    .from('knowledge_chunks')
    .select('id, content, embedding_status')
    .in('document_id', documentIds)
    .in('embedding_status', statuses)
    .is('embedding', null)
    .limit(limit);

  if (chunksRes.error) return { ok: false, reason: asErrorMessage(chunksRes.error) };

  const rows = Array.isArray(chunksRes.data) ? chunksRes.data : [];
  const chunks = rows
    .map((row) => {
      const r = row as { id?: unknown; content?: unknown };
      return {
        id: typeof r.id === 'string' ? r.id : '',
        content: typeof r.content === 'string' ? r.content : '',
      };
    })
    .filter((row) => row.id.length > 0);

  return { ok: true, chunks };
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countStoreResult(
  result: KbEmbeddingStoreResult,
  summary: KbEmbeddingBackfillSummary,
): void {
  if (result.ok) summary.embedded += 1;
  else summary.failed += 1;
}

export async function runKbEmbeddingBackfill(
  supabase: BackfillSupabaseClient,
  options: KbEmbeddingBackfillOptions,
  deps: KbEmbeddingBackfillDeps = {},
): Promise<KbEmbeddingBackfillSummary> {
  const statuses = uniqueStatuses(options.statuses);
  const limit = clampPositiveInt(options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const batchSize = clampPositiveInt(options.batchSize, DEFAULT_BATCH_SIZE, 500);
  const delayMs = clampPositiveInt(options.delayMs, 0, 60_000);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const summary: KbEmbeddingBackfillSummary = {
    ok: false,
    tenantId: options.tenantId,
    scanned: 0,
    embedded: 0,
    failed: 0,
    skipped: 0,
    approximateTokens: 0,
  };

  const pgvector = await checkPgvectorAvailable(supabase);
  if (pgvector.ok === false) return { ...summary, reason: pgvector.reason };

  const loaded = await loadReadyKnowledgeChunksForEmbedding(
    supabase,
    options.tenantId,
    statuses,
    limit,
  );
  if (loaded.ok === false) return { ...summary, reason: loaded.reason };

  summary.scanned = loaded.chunks.length;
  if (loaded.chunks.length === 0) return { ...summary, ok: true };
  if (options.dryRun) return { ...summary, ok: true, skipped: loaded.chunks.length };

  const credentials = await resolveOpenAiEmbeddingCredentials(
    supabase as unknown as SupabaseLikeClient,
    options.tenantId,
  );
  if (credentials.ok === false) return { ...summary, reason: credentials.reason };

  const createEmbeddingClient =
    deps.createEmbeddingClient ??
    ((config: OpenAiEmbeddingClientConfig) => new OpenAiEmbeddingClient(config));
  const client = createEmbeddingClient({
    ...credentials.credentials,
    maxInputsPerRequest: batchSize,
  });
  const storeEmbedding = deps.storeEmbedding ?? storeKnowledgeChunkEmbedding;
  const markFailed = deps.markFailed ?? markKnowledgeChunkEmbeddingFailed;

  for (const batch of chunk(loaded.chunks, batchSize)) {
    const prepared = batch.map((row) => ({
      chunk: row,
      ...prepareEmbeddingInputWithHash(row.content),
    }));
    summary.approximateTokens += prepared.reduce(
      (sum, row) => sum + approxTokens(row.input),
      0,
    );

    try {
      const embeddings = await client.embedTexts(prepared.map((row) => row.input));
      for (const result of embeddings) {
        const row = prepared[result.index];
        if (!row) {
          summary.failed += 1;
          continue;
        }
        const storeResult = await storeEmbedding(supabase, {
          chunkId: row.chunk.id,
          embedding: result.embedding,
          embeddingModel: 'text-embedding-3-small',
          embeddingInputHash: row.hash,
        });
        countStoreResult(storeResult, summary);
      }
    } catch (error) {
      for (const row of prepared) {
        const failed = await markFailed(supabase, {
          chunkId: row.chunk.id,
          error,
          embeddingInputHash: row.hash,
        });
        if (failed.ok) summary.failed += 1;
        else summary.failed += 1;
      }
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return { ...summary, ok: true };
}
