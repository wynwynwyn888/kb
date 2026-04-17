// Send Bubble Processor
// Sends formatted message bubbles back to GHL
// TODO: Implement full send logic

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';

export interface SendBubbleJobData {
  conversationId: string;
  tenantId: string;
  bubbles: Array<{
    content: string;
    index: number;
  }>;
  metadata?: Record<string, unknown>;
}

@Processor(QUEUES.SEND_BUBBLE)
export class SendBubbleProcessor extends WorkerHost {
  async process(job: Job<SendBubbleJobData>): Promise<void> {
    // TODO: Implementation
    // 1. Get GHL connection for tenant
    // 2. Format message for channel (WhatsApp vs others)
    // 3. Send via GHL API
    // 4. Store outbound message in DB
    // 5. Deduct quota (successful send only)
    // 6. Update conversation.lastMessageAt

    console.log('Processing send bubble:', job.data);
    throw new Error('Not implemented');
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`Send bubble job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`Send bubble job ${job.id} failed:`, error.message);
  }
}