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
