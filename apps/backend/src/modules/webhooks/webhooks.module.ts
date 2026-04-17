// Webhooks module - handles inbound GHL webhooks
// Entry point for all incoming messages from GHL

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookVerificationService } from './webhook-verification.service';
import { QUEUES } from '../../queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.INBOUND_MESSAGE_PROCESSOR,
    }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookVerificationService],
  exports: [WebhooksService, WebhookVerificationService],
})
export class WebhooksModule {}
