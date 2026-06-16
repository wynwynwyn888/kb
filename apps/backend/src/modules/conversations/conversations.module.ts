// Conversations module - manages conversation state and messages
// Owns conversation memory, prompt stack, session state

import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationsControllerService } from './conversations-controller.service';
import { ConversationResetService } from './conversation-reset.service';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { FollowUpEngineModule } from '../follow-up-engine/follow-up-engine.module';
import { QUEUES } from '../../queues/queue.constants';

@Module({
  imports: [
    AuthModule,
    TenantsModule,
    BullModule.registerQueue({ name: QUEUES.SEND_BUBBLE }),
    forwardRef(() => FollowUpEngineModule),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsControllerService, ConversationResetService],
  exports: [ConversationsService, ConversationResetService, ConversationsControllerService],
})
export class ConversationsModule {}