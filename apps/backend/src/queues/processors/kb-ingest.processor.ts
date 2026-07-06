import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import { getSupabaseService } from '../../lib/supabase';
import {
  runKbEmbeddingBackfill,
  type BackfillSupabaseClient,
} from '../../modules/kb/embedding/kb-embedding-backfill';
import { kbEmbeddingJobsEnabledForTenant } from '../../modules/kb/embedding/kb-embedding-job-flags';

export interface KbIngestJobData {
  documentId: string;
  tenantId: string;
  reason?: 'create' | 'update' | 'manual' | 'backfill' | 'unknown';
}

/**
 * KB documents/chunks are still written synchronously in KbService. This worker
 * maintains the optional pgvector memory lane after those writes complete.
 */
@Processor(QUEUES.KB_INGEST)
@Injectable()
export class KbIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(KbIngestProcessor.name);

  async process(job: Job<KbIngestJobData>): Promise<void> {
    const tenantId = String(job.data.tenantId ?? '').trim();
    const documentId = String(job.data.documentId ?? '').trim();
    if (!tenantId || !documentId) {
      this.logger.warn(`KB ingest job skipped: missing tenant/document jobId=${job.id}`);
      return;
    }

    if (!kbEmbeddingJobsEnabledForTenant(tenantId)) {
      this.logger.log(
        `KB embedding job skipped: tenant=${tenantId} documentId=${documentId} reason=flag_disabled`,
      );
      return;
    }

    this.logger.log(
      `KB embedding job started: tenant=${tenantId} documentId=${documentId} reason=${job.data.reason ?? 'unknown'}`,
    );

    const summary = await runKbEmbeddingBackfill(getSupabaseService() as unknown as BackfillSupabaseClient, {
      tenantId,
      documentId,
      statuses: ['pending', 'failed'],
      limit: 500,
      batchSize: 32,
      delayMs: 0,
    });

    this.logger.log(
      `KB embedding job completed: tenant=${tenantId} documentId=${documentId} ok=${summary.ok} ` +
        `scanned=${summary.scanned} embedded=${summary.embedded} failed=${summary.failed} ` +
        `skipped=${summary.skipped} approximateTokens=${summary.approximateTokens} ` +
        `reason=${summary.reason ?? 'none'}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`KB ingest job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`KB ingest job ${job.id} failed: ${error.message}`);
  }
}
