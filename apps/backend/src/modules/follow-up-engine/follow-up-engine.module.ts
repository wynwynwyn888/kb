import { Module } from '@nestjs/common';
import { FollowUpSettingsModule } from '../follow-up-settings/follow-up-settings.module';
import { OutboundModule } from '../outbound/outbound.module';
import { PromptsModule } from '../prompts/prompts.module';
import { KbModule } from '../kb/kb.module';
import { GenerationModule } from '../generation/generation.module';
import { AgencyAiConfigModule } from '../agency-ai-config/agency-ai-config.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { FollowUpEngineService } from './follow-up-engine.service';

@Module({
  imports: [
    FollowUpSettingsModule,
    OutboundModule,
    PromptsModule,
    KbModule,
    GenerationModule,
    AgencyAiConfigModule,
    ConversationsModule,
  ],
  providers: [FollowUpEngineService],
  exports: [FollowUpEngineService],
})
export class FollowUpEngineModule {}

