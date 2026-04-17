// Handover Notify Processor
// Notifies agents when handover is requested
// TODO: Implement full notification logic

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
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
  async process(job: Job<HandoverNotifyJobData>): Promise<void> {
    // TODO: Implementation
    // 1. Get tenant users with agent role
    // 2. Create notification for each agent
    // 3. Optionally send via email/Slack/push (future)
    // 4. Update handover event with notification status

    console.log('Processing handover notify:', job.data);
    throw new Error('Not implemented');
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