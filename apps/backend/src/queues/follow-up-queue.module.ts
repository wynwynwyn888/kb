import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES, queueConfig } from './queue.constants';

/**
 * Registers only the follow-up BullMQ queue so `InjectQueue(QUEUES.FOLLOW_UP)` resolves
 * inside feature modules (e.g. FollowUpEngineModule) without importing the full QueuesModule.
 *
 * QueuesModule imports this module and excludes FOLLOW_UP from its bulk registration to avoid
 * registering the same queue twice.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.FOLLOW_UP,
      defaultJobOptions: queueConfig[QUEUES.FOLLOW_UP].defaultJobOptions,
    }),
  ],
  exports: [BullModule],
})
export class FollowUpQueueModule {}
