// AI Router module - routes requests to appropriate AI models
// Considers tenant config, cost, availability

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiRouterController } from './ai-router.controller';
import { AiRouterService } from './ai-router.service';

@Module({
  imports: [AuthModule],
  controllers: [AiRouterController],
  providers: [AiRouterService],
  exports: [AiRouterService],
})
export class AiRouterModule {}