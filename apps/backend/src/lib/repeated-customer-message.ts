import type { MemoryEntry } from '../modules/orchestration/dto/memory-entry';

export type RepeatedHumanTextAction = 'none' | 'answer_again' | 'concise_confirm';

/**
 * Detect consecutive identical **user** lines in persisted memory (different inbound message IDs).
 * Does not dedupe webhooks — only shapes generation when the customer literally repeated themselves.
 */
export function detectRepeatedCustomerUserLines(entries: MemoryEntry[]): {
  repeatedHumanTextDetected: boolean;
  repeatedHumanTextAction: RepeatedHumanTextAction;
} {
  const users = entries.filter(e => e.role === 'user').map(e => e.content ?? '');
  if (users.length < 2) {
    return { repeatedHumanTextDetected: false, repeatedHumanTextAction: 'none' };
  }
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const last = norm(users[users.length - 1]!);
  const prev = norm(users[users.length - 2]!);
  if (last.length === 0 || last !== prev) {
    return { repeatedHumanTextDetected: false, repeatedHumanTextAction: 'none' };
  }
  const third = users.length >= 3 ? norm(users[users.length - 3]!) : '';
  if (third === last) {
    return { repeatedHumanTextDetected: true, repeatedHumanTextAction: 'concise_confirm' };
  }
  return { repeatedHumanTextDetected: true, repeatedHumanTextAction: 'answer_again' };
}
