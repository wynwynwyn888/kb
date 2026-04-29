// Conversation memory loader — loads recent message history from DB
// for use in AI prompt context building.

import { Injectable, Logger } from '@nestjs/common';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import type { ConversationMemory, MemoryEntry } from './dto';

const MAX_TURNS = 10; // last 10 user turns to load

@Injectable()
export class ConversationMemoryLoader {
  private readonly logger = new Logger(ConversationMemoryLoader.name);
  private readonly supabase = getSupabaseService();

  /**
   * Load last MAX_TURNS user turns from the conversation, ordered oldest→newest.
   * Returns normalized MemoryEntry[] for AI context building.
   *
   * When `memoryResetAfterIso` is set (from `metadata.aisbp_policy.memoryResetAt`), only messages
   * with `created_at` **strictly after** that instant are included — chat `/new` resets without
   * deleting DB rows.
   */
  async loadMemory(
    conversationId: string,
    opts?: { memoryResetAfterIso?: string | null },
  ): Promise<ConversationMemory> {
    // Load messages ordered oldest→newest (ascending created_at)
    // Limit to last MAX_TURNS inbound user messages plus their AI responses
    const { data, error } = await this.supabase
      .from('messages')
      .select('id, direction, sender, content, contentType, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error || !data) {
      this.logger.warn(
        `Failed to load memory for conversation=${conversationId}: ${formatPostgrestError(error ?? 'no data')}`,
      );
      return {
        conversationId,
        entries: [],
        turnCount: 0,
        sessionStartedAt: null,
      };
    }

    const resetAfter = opts?.memoryResetAfterIso?.trim() ?? '';
    const scoped = resetAfter
      ? data.filter(m => String(m.created_at ?? '') > resetAfter)
      : data;

    // Filter to last N user turns and their responses
    const userMessages = scoped.filter(m => m.direction === 'INBOUND');
    const recentUserMessages = userMessages.slice(-MAX_TURNS);

    if (recentUserMessages.length === 0) {
      return {
        conversationId,
        entries: [],
        turnCount: 0,
        sessionStartedAt: null,
      };
    }

    // Get the index range to include responses after each user turn
    const lastUserIndex = scoped.findIndex(
      m => m.id === recentUserMessages[recentUserMessages.length - 1]!.id,
    );
    const slice = scoped.slice(
      scoped.findIndex(m => m.id === recentUserMessages[0]!.id),
      lastUserIndex + 1,
    );

    const entries: MemoryEntry[] = slice.map(m => this.normalizeMessage(m));

    // TODO: Detect 24h gap for session reset here
    // For now, sessionStartedAt is set to the oldest loaded message
    const sessionStartedAt =
      entries.length > 0 ? entries[0]!.timestamp : null;

    // Count user turns
    const turnCount = entries.filter(e => e.role === 'user').length;

    this.logger.debug(
      `Loaded memory: conversationId=${conversationId}, entries=${entries.length}, turns=${turnCount}`,
    );

    return {
      conversationId,
      entries,
      turnCount,
      sessionStartedAt,
    };
  }

  private normalizeMessage(
    msg: {
      direction: string;
      sender: string;
      content: string;
      contentType?: string;
      content_type?: string;
      created_at: string;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): MemoryEntry {
    const roleMap: Record<string, 'user' | 'assistant' | 'system'> = {
      INBOUND: 'user',
      OUTBOUND: 'assistant',
    };

    const typeMap: Record<string, 'text' | 'image' | 'audio' | 'video' | 'unknown'> = {
      text: 'text',
      image: 'image',
      audio: 'audio',
      video: 'video',
      document: 'unknown',
      TEXT: 'text',
      IMAGE: 'image',
      AUDIO: 'audio',
      VIDEO: 'video',
      DOCUMENT: 'unknown',
    };

    const ct = msg.contentType ?? msg.content_type ?? 'TEXT';
    return {
      role: roleMap[msg.direction] ?? 'user',
      content: msg.content,
      sender: msg.sender as MemoryEntry['sender'],
      timestamp: msg.created_at,
      messageType: typeMap[ct] ?? 'unknown',
    };
  }
}
