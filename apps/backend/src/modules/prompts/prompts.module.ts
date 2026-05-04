// Prompts module - manages system prompts and prompt configurations
// Agency owns system policies, Tenant owns prompt configs

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';
import { BotProfilesService } from './bot-profiles.service';

@Module({
  imports: [AuthModule],
  controllers: [PromptsController],
  providers: [PromptsService, BotProfilesService],
  exports: [PromptsService, BotProfilesService],
})
export class PromptsModule {}