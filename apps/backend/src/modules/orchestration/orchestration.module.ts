// Orchestration module — orchestrates inbound message handling
// Loads context, runs guards, loads memory, retrieves KB, routes to AI, plans reply.

import { Module } from '@nestjs/common';
import { ConversationOrchestrationService } from './orchestration.service';
import { OrchestrationGuards } from './orchestration-guards.service';
import { ConversationMemoryLoader } from './conversation-memory-loader';
import { AiRouterModule } from '../ai-router/ai-router.module';
import { KbModule } from '../kb/kb.module';
import { ReplyPlanningModule } from '../reply-planning/reply-planning.module';
import { ConversationPolicyModule } from '../conversation-policy/conversation-policy.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [
    AiRouterModule,
    KbModule,
    ReplyPlanningModule,
    ConversationPolicyModule,
    ConversationsModule,
  ],
  providers: [
    ConversationOrchestrationService,
    OrchestrationGuards,
    ConversationMemoryLoader,
  ],
  exports: [ConversationOrchestrationService],
})
export class OrchestrationModule {}
