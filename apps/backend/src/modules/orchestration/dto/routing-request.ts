// AI routing request — input to the AI router's route() method
// after guards pass and memory is loaded.

import type { MemoryEntry } from './memory-entry';

export interface RoutingRequest {
  tenantId: string;
  conversationId: string;
  incomingMessage: string;
  incomingMessageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  systemPrompt: string;
  memory: MemoryEntry[];
  channel: string;
  // Optional hints from orchestration context
  handoverRecommended: boolean;
  bookingIntentDetected: boolean;
  estimatedInputTokens: number;
}
