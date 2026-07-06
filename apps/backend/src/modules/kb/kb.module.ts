// KB (Knowledge Base) module - manages documents and embeddings
// Handles ingestion, chunking, embedding generation, and retrieval

import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';
import { QUEUES } from '../../queues/queue.constants';

@Module({
  imports: [AuthModule, forwardRef(() => TenantsModule), BullModule.registerQueue({ name: QUEUES.KB_INGEST })],
  controllers: [KbController],
  providers: [KbService],
  exports: [KbService],
})
export class KbModule {}
