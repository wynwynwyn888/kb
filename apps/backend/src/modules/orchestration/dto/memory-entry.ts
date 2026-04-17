// Normalized memory entry — a single turn in the conversation history
// Used for building AI prompt context.

export interface MemoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  sender: 'CONTACT' | 'AI' | 'AGENT' | 'SYSTEM';
  timestamp: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
}

// Memory loader output
export interface ConversationMemory {
  conversationId: string;
  entries: MemoryEntry[];
  turnCount: number; // user turns only
  sessionStartedAt: string | null; // null if no reset yet
}
