// Conversations service - manages conversation state and messages

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectQueue('send-bubble') private readonly sendQueue: Queue,
  ) {}

  // TODO: Implement conversation management
  // - Create/get conversation by GHL conversation ID
  // - Store messages with sender, direction, metadata
  // - Maintain conversation memory (last 10 turns)
  // - Session reset after 24 hours of inactivity
  // - Enqueue send-bubble job on outbound

  async getOrCreateConversation(tenantId: string, ghlConversationId: string) {
    throw new Error('Not implemented');
  }

  async addMessage(conversationId: string, message: {
    direction: string;
    sender: string;
    content: string;
    contentType?: string;
    metadata?: Record<string, unknown>;
  }) {
    throw new Error('Not implemented');
  }

  async getRecentMessages(conversationId: string, limit: number = 10) {
    throw new Error('Not implemented');
  }

  async shouldResetSession(conversationId: string): Promise<boolean> {
    // Check if last message was > 24 hours ago
    throw new Error('Not implemented');
  }
}