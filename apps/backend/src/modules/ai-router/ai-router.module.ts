// AI Router module - routes requests to appropriate AI models
// Considers tenant config, cost, availability

import { Module } from '@nestjs/common';
import { AiRouterController } from './ai-router.controller';
import { AiRouterService } from './ai-router.service';

@Module({
  controllers: [AiRouterController],
  providers: [AiRouterService],
  exports: [AiRouterService],
})
export class AiRouterModule {}