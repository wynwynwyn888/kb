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
import { BookingFlowModule } from '../booking-flow/booking-flow.module';
import { BookingSettingsModule } from '../booking-settings/booking-settings.module';

import { PromptsModule } from '../prompts/prompts.module';
import { HumanEscalationModule } from '../human-escalation/human-escalation.module';

@Module({
  imports: [
    AiRouterModule,
    KbModule,
    ReplyPlanningModule,
    ConversationPolicyModule,
    ConversationsModule,
    BookingFlowModule,
    BookingSettingsModule,
    PromptsModule,
    HumanEscalationModule,
  ],
  providers: [
    ConversationOrchestrationService,
    OrchestrationGuards,
    ConversationMemoryLoader,
  ],
  exports: [ConversationOrchestrationService],
})
export class OrchestrationModule {}
