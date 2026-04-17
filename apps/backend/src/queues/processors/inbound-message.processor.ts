// Inbound Message Processor
// Processes incoming messages from GHL webhooks
// TODO: Implement full processing logic

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';

export interface InboundMessageJobData {
  locationId: string;
  ghlConversationId: string;
  ghlContactId: string;
  messageContent: string;
  messageType: 'text' | 'image' | 'audio' | 'video';
  timestamp: string;
}

@Processor(QUEUES.INBOUND_MESSAGE_PROCESSOR)
export class InboundMessageProcessor extends WorkerHost {
  async process(job: Job<InboundMessageJobData>): Promise<void> {
    // TODO: Implementation
    // 1. Load tenant by locationId
    // 2. Get or create conversation
    // 3. Store inbound message
    // 4. Check if conversation is in handover - if so, skip AI
    // 5. Load conversation context (last 10 turns)
    // 6. Search KB for relevant info
    // 7. Build prompt with system prompt + context + KB
    // 8. Route to AI
    // 9. Format response
    // 10. Enqueue send-bubble job
    // 11. Deduct quota on successful send

    console.log('Processing inbound message:', job.data);
    throw new Error('Not implemented');
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`Inbound message job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`Inbound message job ${job.id} failed:`, error.message);
  }
}