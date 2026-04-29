/** Matches debounce in inbound-message.processor + slack for clock skew / slow delivery. */
export const INBOUND_DEBOUNCE_MS = 5000;
export const INBOUND_BURST_EXTRA_SLACK_MS = 15000;

export function inboundBurstLookbackMs(): number {
  return INBOUND_DEBOUNCE_MS + INBOUND_BURST_EXTRA_SLACK_MS;
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
