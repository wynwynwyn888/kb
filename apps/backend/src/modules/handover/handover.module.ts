// Handover module - manages conversation handover to human agents
// Pauses AI replies during handover, tracks handover events

import { Module } from '@nestjs/common';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';
import { AuthModule } from '../auth/auth.module';
import { GhlModule } from '../ghl/ghl.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [AuthModule, GhlModule, TenantsModule, ConversationsModule],
  controllers: [HandoverController],
  providers: [HandoverService],
  exports: [HandoverService],
})
export class HandoverModule {}