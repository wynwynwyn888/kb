import { Module } from '@nestjs/common';
import { ConversationMemoryLoader } from './conversation-memory-loader';

@Module({
  providers: [ConversationMemoryLoader],
  exports: [ConversationMemoryLoader],
})
export class ConversationMemoryModule {}
