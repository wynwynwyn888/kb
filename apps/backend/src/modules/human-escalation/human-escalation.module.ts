import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GhlModule } from '../ghl/ghl.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { FollowUpEngineModule } from '../follow-up-engine/follow-up-engine.module';
import { GenerationModule } from '../generation/generation.module';
import { HumanEscalationSettingsService } from './human-escalation-settings.service';
import { HumanEscalationSettingsController } from './human-escalation-settings.controller';
import { HumanEscalationNotifyService } from './human-escalation-notify.service';
import { HumanEscalationRuntimeService } from './human-escalation-runtime.service';

@Module({
  imports: [
    AuthModule,
    GhlModule,
    ConversationsModule,
    FollowUpEngineModule,
    GenerationModule,
  ],
  controllers: [HumanEscalationSettingsController],
  providers: [
    HumanEscalationSettingsService,
    HumanEscalationNotifyService,
    HumanEscalationRuntimeService,
  ],
  exports: [HumanEscalationSettingsService, HumanEscalationNotifyService, HumanEscalationRuntimeService],
})
export class HumanEscalationModule {}
