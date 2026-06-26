import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { AuthModule } from '../auth/auth.module';
import { QUEUES } from '../../queues/queue.constants';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue(
      { name: QUEUES.INBOUND_MESSAGE_PROCESSOR },
      { name: QUEUES.SEND_BUBBLE },
      { name: QUEUES.MEDIA_TRANSCRIPTION },
      { name: QUEUES.KB_INGEST },
      { name: QUEUES.FOLLOW_UP },
    ),
  ],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
