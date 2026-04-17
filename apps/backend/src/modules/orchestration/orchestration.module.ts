// Orchestration module — orchestrates inbound message handling
// Loads context, runs guards, loads memory, routes to AI model.

import { Module } from '@nestjs/common';
import { ConversationOrchestrationService } from './orchestration.service';
import { OrchestrationGuards } from './orchestration-guards.service';
import { ConversationMemoryLoader } from './conversation-memory-loader';
import { AiRouterModule } from '../ai-router/ai-router.module';

@Module({
  imports: [AiRouterModule],
  providers: [
    ConversationOrchestrationService,
    OrchestrationGuards,
    ConversationMemoryLoader,
  ],
  exports: [ConversationOrchestrationService],
})
export class OrchestrationModule {}
