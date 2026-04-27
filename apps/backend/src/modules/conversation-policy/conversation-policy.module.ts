import { Module } from '@nestjs/common';
import { ConversationPolicyEngineService } from './conversation-policy-engine.service';

@Module({
  providers: [ConversationPolicyEngineService],
  exports: [ConversationPolicyEngineService],
})
export class ConversationPolicyModule {}
