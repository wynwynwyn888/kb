import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';

export interface KbIngestJobData {
  documentId: string;
  tenantId: string;
}

/**
 * KB documents are ingested synchronously in KbService today.
 * This processor acknowledges queued jobs so retries do not fail indefinitely.
 */
@Processor(QUEUES.KB_INGEST)
@Injectable()
export class KbIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(KbIngestProcessor.name);

  async process(job: Job<KbIngestJobData>): Promise<void> {
    this.logger.log(
      `KB ingest job acknowledged (sync ingest path): documentId=${job.data.documentId} tenantId=${job.data.tenantId}`,
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
