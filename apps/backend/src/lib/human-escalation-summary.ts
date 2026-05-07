import type { MemoryEntry } from '../modules/orchestration/dto/memory-entry';

/**
 * Short deterministic summary for internal staff alerts (no LLM on critical path).
 */
export function buildDeterministicHumanEscalationSummary(
  latestCustomerMessage: string,
  memory: MemoryEntry[],
  maxChars = 400,
): string {
  const latest = latestCustomerMessage.trim();
  const recentInbound = [...memory]
    .filter(m => m.role === 'user')
    .map(m => String(m.content ?? '').trim())
    .filter(Boolean)
    .slice(-4);

  const parts = [...new Set([...recentInbound, latest].filter(Boolean))];
  const joined = parts.join(' · ');
  if (joined.length <= maxChars) return joined || 'Customer requested human assistance.';
  return `${joined.slice(0, maxChars - 1)}…`;
}
