// Prompts module - manages system prompts and prompt configurations
// Agency owns system policies, Tenant owns prompt configs

import { Module } from '@nestjs/common';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';

@Module({
  controllers: [PromptsController],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}