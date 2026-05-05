/** Exact inbound body (trimmed) that triggers a bot memory reset, case-insensitive. */
export const CHAT_RESET_COMMANDS = ['/new', '/reset', '/startover'] as const;

export type ChatResetCommand = (typeof CHAT_RESET_COMMANDS)[number];

/**
 * Returns the canonical command if `text` is exactly one of the reset commands (trimmed, case-insensitive).
 * Does not match substrings (e.g. "something new").
 */
export function matchChatResetCommand(text: string): ChatResetCommand | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  for (const c of CHAT_RESET_COMMANDS) {
    if (t === c.toLowerCase()) return c;
  }
  return null;
}

/** Omit reset-command lines when building debounced inbound batches for AI orchestration. */
export function isChatResetInboundLine(text: string): boolean {
  return matchChatResetCommand(text) !== null;
}

/** Drop reset-command inbound rows before burst-window batching (avoid `/new` leaking into next turn). */
export function excludeChatResetInboundRows<T extends { content?: string | null }>(rows: T[]): T[] {
  return rows.filter(r => !isChatResetInboundLine(String(r.content ?? '').trim()));
}
