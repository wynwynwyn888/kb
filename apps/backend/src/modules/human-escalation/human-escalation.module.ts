import { Module } from '@nestjs/common';
import { GhlModule } from '../ghl/ghl.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { FollowUpEngineModule } from '../follow-up-engine/follow-up-engine.module';
import { HumanEscalationSettingsService } from './human-escalation-settings.service';
import { HumanEscalationSettingsController } from './human-escalation-settings.controller';
import { HumanEscalationNotifyService } from './human-escalation-notify.service';
import { HumanEscalationRuntimeService } from './human-escalation-runtime.service';

@Module({
  imports: [GhlModule, ConversationsModule, FollowUpEngineModule],
  controllers: [HumanEscalationSettingsController],
  providers: [
    HumanEscalationSettingsService,
    HumanEscalationNotifyService,
    HumanEscalationRuntimeService,
  ],
  exports: [HumanEscalationSettingsService, HumanEscalationNotifyService, HumanEscalationRuntimeService],
})
export class HumanEscalationModule {}
