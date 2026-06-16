// Handover Notify Processor
// Notifies agents when handover is requested
// TODO: Implement full notification logic

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';

export interface HandoverNotifyJobData {
  conversationId: string;
  tenantId: string;
  handoverType: 'request' | 'transfer';
  contactName?: string;
  note?: string;
}

@Processor(QUEUES.HANDOVER_NOTIFY)
export class HandoverNotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(HandoverNotifyProcessor.name);

  async process(job: Job<HandoverNotifyJobData>): Promise<void> {
    this.logger.warn(
      `handoverNotifySkipped ${JSON.stringify({
        reason: 'processor_not_implemented',
        conversationId: job.data.conversationId,
        tenantId: job.data.tenantId,
      })}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`Handover notify job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`Handover notify job ${job.id} failed:`, error.message);
  }
}