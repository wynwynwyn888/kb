import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import {
  runKbVectorShadow,
  type KbVectorShadowKeywordCandidate,
  type QueryEmbeddingCache,
} from '../../modules/kb/embedding/kb-vector-shadow.runner';

export interface KbVectorShadowJobData {
  tenantId: string;
  conversationId?: string;
  query: string;
  intentHint?: string;
  documentIdAllowlist?: string[] | null;
  keywordCandidates?: KbVectorShadowKeywordCandidate[];
}

const QUERY_EMBEDDING_CACHE_MAX = 100;

/**
 * Bounded (max 100) LRU cache for query embeddings. Insertion-order Map: on a
 * hit we re-insert to mark the entry most-recently-used; when full we evict the
 * oldest key. Errors are never cached (the runner only calls `set` on success).
 */
export class QueryEmbeddingLruCache implements QueryEmbeddingCache {
  private readonly store = new Map<string, number[]>();

  constructor(private readonly max: number) {}

  get(key: string): number[] | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: string, value: number[]): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

/**
 * Dedicated worker for the RAG shadow lane. All OpenAI/RPC work for the shadow
 * comparison happens HERE, off the reply request path.
 *
 * SAFETY CONTRACT:
 * - `process` returns void, mutates no reply data, and swallows all errors.
 * - The runner is log-only; it can never inject, reorder, replace, delay, or
 *   error a customer reply.
 */
@Processor(QUEUES.KB_VECTOR_SHADOW)
@Injectable()
export class KbVectorShadowProcessor extends WorkerHost {
  private readonly logger = new Logger(KbVectorShadowProcessor.name);
  private readonly queryEmbeddingCache = new QueryEmbeddingLruCache(QUERY_EMBEDDING_CACHE_MAX);

  async process(job: Job<KbVectorShadowJobData>): Promise<void> {
    try {
      const tenantId = String(job.data?.tenantId ?? '').trim();
      const query = String(job.data?.query ?? '').trim();
      if (!tenantId || !query) return;

      await runKbVectorShadow(
        {
          tenantId,
          conversationId: job.data.conversationId,
          query,
          intentHint: job.data.intentHint,
          documentIdAllowlist: job.data.documentIdAllowlist ?? null,
          keywordCandidates: job.data.keywordCandidates ?? [],
        },
        { logger: this.logger, queryEmbeddingCache: this.queryEmbeddingCache },
      );
    } catch (error) {
      // Defensive: the runner never throws, but a shadow job must never surface
      // an error anywhere. Log and move on.
      this.logger.warn(
        `kb_vector_shadow processor swallowed error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.warn(`KB vector shadow job ${job.id} failed (no reply impact): ${error.message}`);
  }
}
