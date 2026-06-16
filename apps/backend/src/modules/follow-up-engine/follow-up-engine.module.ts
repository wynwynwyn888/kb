import { Module, forwardRef } from '@nestjs/common';
import { FollowUpSettingsModule } from '../follow-up-settings/follow-up-settings.module';
import { OutboundModule } from '../outbound/outbound.module';
import { PromptsModule } from '../prompts/prompts.module';
import { KbModule } from '../kb/kb.module';
import { GenerationModule } from '../generation/generation.module';
import { AgencyAiConfigModule } from '../agency-ai-config/agency-ai-config.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { FollowUpQueueModule } from '../../queues/follow-up-queue.module';
import { FollowUpEngineService } from './follow-up-engine.service';

@Module({
  imports: [
    // BullQueue_follow-up — required for @InjectQueue(QUEUES.FOLLOW_UP) on FollowUpEngineService
    FollowUpQueueModule,
    FollowUpSettingsModule,
    OutboundModule,
    PromptsModule,
    KbModule,
    GenerationModule,
    AgencyAiConfigModule,
    forwardRef(() => ConversationsModule),
  ],
  providers: [FollowUpEngineService],
  exports: [FollowUpEngineService],
})
export class FollowUpEngineModule {}
