// KB Ingest Processor
// Ingests documents into knowledge base with embeddings
// TODO: Implement full ingestion logic

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';

export interface KbIngestJobData {
  documentId: string;
  tenantId: string;
}

@Processor(QUEUES.KB_INGEST)
export class KbIngestProcessor extends WorkerHost {
  async process(job: Job<KbIngestJobData>): Promise<void> {
    // TODO: Implementation
    // 1. Load document from DB
    // 2. Extract text based on mime type
    // 3. Chunk content (semantic or fixed-size)
    // 4. Generate embeddings using configured AI provider
    // 5. Store chunks in DB with vectors (pgvector)
    // 6. Update document status to 'ready' or 'failed'
    // 7. Create notification for tenant user

    console.log('Processing KB ingest:', job.data);
    throw new Error('Not implemented');
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`KB ingest job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`KB ingest job ${job.id} failed:`, error.message);
  }
}