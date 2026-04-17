// Orchestration module — orchestrates inbound message handling
// Loads context, runs guards, loads memory, retrieves KB, routes to AI model.

import { Module } from '@nestjs/common';
import { ConversationOrchestrationService } from './orchestration.service';
import { OrchestrationGuards } from './orchestration-guards.service';
import { ConversationMemoryLoader } from './conversation-memory-loader';
import { AiRouterModule } from '../ai-router/ai-router.module';
import { KbModule } from '../kb/kb.module';

@Module({
  imports: [AiRouterModule, KbModule],
  providers: [
    ConversationOrchestrationService,
    OrchestrationGuards,
    ConversationMemoryLoader,
  ],
  exports: [ConversationOrchestrationService],
})
export class OrchestrationModule {}
