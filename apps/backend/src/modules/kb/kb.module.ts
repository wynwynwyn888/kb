// KB (Knowledge Base) module - manages documents and embeddings
// Handles ingestion, chunking, embedding generation, and retrieval

import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';

@Module({
  imports: [AuthModule, forwardRef(() => TenantsModule)],
  controllers: [KbController],
  providers: [KbService],
  exports: [KbService],
})
export class KbModule {}