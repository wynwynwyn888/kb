// Webhooks service - processes incoming GHL webhooks

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class WebhooksService {
  constructor(
    @InjectQueue('inbound-message-processor') private readonly inboundQueue: Queue,
  ) {}

  // TODO: Implement webhook verification
  // - Verify GHL signature
  // - Validate payload structure
  // - Rate limiting per location

  async enqueueInboundMessage(payload: {
    locationId: string;
    conversationId: string;
    contactId: string;
    message: string;
    messageType: string;
    timestamp: string;
  }): Promise<void> {
    await this.inboundQueue.add('process', payload, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });
  }
}