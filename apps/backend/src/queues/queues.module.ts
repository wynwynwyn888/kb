// Queue module - registers all BullMQ queues

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES, queueConfig } from './queue.constants';

// Import processors
import { InboundMessageProcessor } from './processors/inbound-message.processor';
import { SendBubbleProcessor } from './processors/send-bubble.processor';
import { KbIngestProcessor } from './processors/kb-ingest.processor';
import { HandoverNotifyProcessor } from './processors/handover-notify.processor';
import { QuotaThresholdAlertProcessor } from './processors/quota-threshold-alert.processor';

// Feature modules
import { OrchestrationModule } from '../modules/orchestration/orchestration.module';
import { OutboundModule } from '../modules/outbound/outbound.module';

@Module({
  imports: [
    BullModule.registerQueue(
      ...Object.entries(queueConfig).map(([name, config]) => ({
        name,
        defaultJobOptions: config.defaultJobOptions,
      })),
    ),
    OrchestrationModule,
    OutboundModule,
  ],
  providers: [
    InboundMessageProcessor,
    SendBubbleProcessor,
    KbIngestProcessor,
    HandoverNotifyProcessor,
    QuotaThresholdAlertProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule {}