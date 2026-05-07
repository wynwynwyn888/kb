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
import { FollowUpProcessor } from './processors/follow-up.processor';

// Feature modules
import { OrchestrationModule } from '../modules/orchestration/orchestration.module';
import { OutboundModule } from '../modules/outbound/outbound.module';
import { ConversationsModule } from '../modules/conversations/conversations.module';
import { ActionGatingModule } from '../modules/action-gating/action-gating.module';
import { IntentTagsModule } from '../modules/intent-tags/intent-tags.module';
import { TranscriptionModule } from '../modules/transcription/transcription.module';
import { FollowUpEngineModule } from '../modules/follow-up-engine/follow-up-engine.module';
import { FollowUpQueueModule } from './follow-up-queue.module';
import { HumanEscalationHoldingReplyService } from '../modules/human-escalation/human-escalation-holding-reply.service';
import { HumanEscalationModule } from '../modules/human-escalation/human-escalation.module';

@Module({
  imports: [
    // Register all queues except follow-up here — follow-up is registered via FollowUpQueueModule
    // (also imported by FollowUpEngineModule) to avoid double registration.
    BullModule.registerQueue(
      ...Object.entries(queueConfig)
        .filter(([name]) => name !== QUEUES.FOLLOW_UP)
        .map(([name, config]) => ({
          name,
          defaultJobOptions: config.defaultJobOptions,
        })),
    ),
    FollowUpQueueModule,
    OrchestrationModule,
    OutboundModule,
    ConversationsModule,
    ActionGatingModule,
    IntentTagsModule,
    TranscriptionModule,
    FollowUpEngineModule,
    HumanEscalationModule,
  ],
  providers: [
    HumanEscalationHoldingReplyService,
    InboundMessageProcessor,
    SendBubbleProcessor,
    KbIngestProcessor,
    HandoverNotifyProcessor,
    QuotaThresholdAlertProcessor,
    FollowUpProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule {}