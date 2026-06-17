// Conversation memory loader — loads recent message history from DB
// for use in AI prompt context building.

import { Injectable, Logger } from '@nestjs/common';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import type { ConversationMemory, MemoryEntry } from './dto';

const MAX_TURNS = 20; // last 20 user turns to load
/** Upper bound on rows fetched before slicing to turns (inbound + outbound pairs). */
const MAX_MESSAGE_ROWS = MAX_TURNS * 8;
/** Gap after which conversation memory starts a fresh session (no prior turns in prompt). */
export const CONVERSATION_MEMORY_SESSION_GAP_MS = 24 * 60 * 60 * 1000;

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
    const resetAfter = opts?.memoryResetAfterIso?.trim() ?? '';

    let query = this.supabase
      .from('messages')
      .select('id, direction, sender, content, contentType, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MAX_MESSAGE_ROWS);

    if (resetAfter) {
      query = query.gt('created_at', resetAfter);
    }

    const { data: rawRows, error } = await query;

    if (error || !rawRows) {
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

    const data = [...rawRows].reverse();

    if (data.length > 0) {
      const lastRow = data[data.length - 1] as { created_at?: string };
      const lastMs = lastRow.created_at ? Date.parse(String(lastRow.created_at)) : NaN;
      if (Number.isFinite(lastMs) && Date.now() - lastMs > CONVERSATION_MEMORY_SESSION_GAP_MS) {
        this.logger.debug(
          `Memory session gap reset: conversationId=${conversationId} gapMs=${Date.now() - lastMs}`,
        );
        return {
          conversationId,
          entries: [],
          turnCount: 0,
          sessionStartedAt: null,
        };
      }
    }

    const scoped = data.filter((row, idx) => {
      if (idx === 0) return true;
      const prev = data[idx - 1] as { created_at?: string };
      const cur = row as { created_at?: string };
      const prevMs = prev.created_at ? Date.parse(String(prev.created_at)) : NaN;
      const curMs = cur.created_at ? Date.parse(String(cur.created_at)) : NaN;
      if (!Number.isFinite(prevMs) || !Number.isFinite(curMs)) return true;
      return curMs - prevMs <= CONVERSATION_MEMORY_SESSION_GAP_MS;
    });

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
