/** Burst lookback uses the same debounce window as inbound-message.processor + slack for clock skew / slow delivery. */

export const INBOUND_DEBOUNCE_ENV_KEY = 'AISBP_INBOUND_DEBOUNCE_MS';
const INBOUND_DEBOUNCE_MIN_MS = 750;
const INBOUND_DEBOUNCE_MAX_MS = 10_000;
const INBOUND_DEBOUNCE_FALLBACK_MS = 2000;

export const INBOUND_BURST_EXTRA_SLACK_MS = 15000;

export type InboundDebounceSource = 'env' | 'default';

/**
 * Reads `AISBP_INBOUND_DEBOUNCE_MS` (integer ms). Missing/invalid → 2000ms, `debounceSource: 'default'`.
 * Valid integers are clamped to [750, 10000]; `debounceSource: 'env'`.
 */
export function resolveInboundDebounceMs(): {
  debounceMs: number;
  debounceSource: InboundDebounceSource;
} {
  const raw = process.env[INBOUND_DEBOUNCE_ENV_KEY]?.trim();
  if (!raw) {
    return { debounceMs: INBOUND_DEBOUNCE_FALLBACK_MS, debounceSource: 'default' };
  }
  if (!/^\d+$/.test(raw)) {
    return { debounceMs: INBOUND_DEBOUNCE_FALLBACK_MS, debounceSource: 'default' };
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return { debounceMs: INBOUND_DEBOUNCE_FALLBACK_MS, debounceSource: 'default' };
  }
  const debounceMs = Math.min(INBOUND_DEBOUNCE_MAX_MS, Math.max(INBOUND_DEBOUNCE_MIN_MS, n));
  return { debounceMs, debounceSource: 'env' };
}

export function inboundBurstLookbackMs(): number {
  const { debounceMs } = resolveInboundDebounceMs();
  return debounceMs + INBOUND_BURST_EXTRA_SLACK_MS;
}

export type InboundRowForBurst = { created_at: string; content?: string | null };

/**
 * Rows must be ordered newest-first (same as Supabase `order(created_at, desc)`).
 * Returns message bodies oldest→newest for messages in the burst window anchored on the newest row.
 */
export function filterInboundRowsToBurstWindow(rowsNewestFirst: InboundRowForBurst[]): string[] {
  if (!rowsNewestFirst.length) return [];
  const newest = new Date(rowsNewestFirst[0]!.created_at).getTime();
  const cutoff = newest - inboundBurstLookbackMs();
  const asc = [...rowsNewestFirst].reverse();
  return asc
    .filter(r => new Date(r.created_at).getTime() >= cutoff)
    .map(r => String(r.content ?? '').trim())
    .filter(Boolean);
}
