// Conversations module - manages conversation state and messages
// Owns conversation memory, prompt stack, session state

import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationsControllerService } from './conversations-controller.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsControllerService],
  exports: [ConversationsService],
})
export class ConversationsModule {}