// AI routing request — input to the AI router's route() method
// after guards pass and memory is loaded.

import type { MemoryEntry } from './memory-entry';
import type { RetrievalChunk } from '../../kb/dto/retrieval.dto';

export interface RoutingRequest {
  tenantId: string;
  conversationId: string;
  incomingMessage: string;
  incomingMessageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  systemPrompt: string;
  memory: MemoryEntry[];
  kbContext: RetrievalChunk[];
  channel: string;
  // Optional hints from orchestration context
  handoverRecommended: boolean;
  bookingIntentDetected: boolean;
  estimatedInputTokens: number;
}
