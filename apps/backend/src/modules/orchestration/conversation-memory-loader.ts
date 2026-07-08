// Conversation memory loader — loads recent message history from DB
// for use in AI prompt context building.

import { Injectable, Logger } from '@nestjs/common';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import type { ConversationMemory, MemoryEntry } from './dto';
import { matchChatResetCommand } from '../../lib/chat-reset-command';

export const CONVERSATION_MEMORY_MESSAGE_LIMIT = 30;
/** Gap after which conversation memory starts a fresh session (no prior turns in prompt). */
export const CONVERSATION_MEMORY_SESSION_GAP_MS = 24 * 60 * 60 * 1000;
const PROMPT_DUPLICATE_WINDOW_MS = 10_000;
const CHAT_RESET_CONFIRMATION_RE =
  /started a fresh chat for this conversation\.\s*you can test from here\./i;

function isPromptMemoryAdministrativeRow(row: { direction?: string; sender?: string; content?: string | null }): boolean {
  const content = String(row.content ?? '').trim();
  if (!content) return true;
  if (row.direction === 'INBOUND' && row.sender === 'CONTACT' && matchChatResetCommand(content)) {
    return true;
  }
  if (row.direction === 'OUTBOUND' && row.sender === 'AI' && CHAT_RESET_CONFIRMATION_RE.test(content)) {
    return true;
  }
  return false;
}

function normalizePromptContent(content: string | null | undefined): string {
  return String(content ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function collapsePromptDuplicateRows<T extends {
  direction?: string;
  sender?: string;
  content?: string | null;
  created_at?: string;
}>(rowsOldestFirst: T[]): T[] {
  const out: T[] = [];
  for (const row of rowsOldestFirst) {
    const prev = out[out.length - 1];
    if (prev) {
      const prevMs = prev.created_at ? Date.parse(String(prev.created_at)) : NaN;
      const rowMs = row.created_at ? Date.parse(String(row.created_at)) : NaN;
      const sameTurn =
        prev.direction === row.direction &&
        prev.sender === row.sender &&
        normalizePromptContent(prev.content) === normalizePromptContent(row.content);
      const closeTogether =
        Number.isFinite(prevMs) &&
        Number.isFinite(rowMs) &&
        Math.abs(rowMs - prevMs) <= PROMPT_DUPLICATE_WINDOW_MS;
      if (sameTurn && closeTogether) {
        continue;
      }
    }
    out.push(row);
  }
  return out;
}

@Injectable()
export class ConversationMemoryLoader {
  private readonly logger = new Logger(ConversationMemoryLoader.name);
  private readonly supabase = getSupabaseService();

  /**
   * Load the latest conversation transcript from the DB, ordered oldest→newest.
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
    const resetAfter = opts?.memoryResetAfterIso?.trim() ?? '';

    let query = this.supabase
      .from('messages')
      .select('id, direction, sender, content, contentType, created_at, metadata')
      .eq('conversation_id', conversationId);

    if (resetAfter) {
      query = query.gt('created_at', resetAfter);
    }

    query = query.order('created_at', { ascending: false }).limit(CONVERSATION_MEMORY_MESSAGE_LIMIT);

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

    const data = collapsePromptDuplicateRows(
      [...rawRows].reverse().filter(row => !isPromptMemoryAdministrativeRow(row)),
    );

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

    if (scoped.length === 0) {
      return {
        conversationId,
        entries: [],
        turnCount: 0,
        sessionStartedAt: null,
      };
    }

    const entries: MemoryEntry[] = scoped.map(m => this.normalizeMessage(m));

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
