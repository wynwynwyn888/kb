/**
 * Conversation-level inbound debounce metadata (`conversations.metadata.inboundDebounce`).
 * Each new customer message bumps `pendingVersion`; delayed jobs carry a version and skip if stale.
 */

export function bumpInboundDebounceMeta(existingMeta: unknown): { merged: Record<string, unknown>; newVersion: number } {
  const meta =
    existingMeta && typeof existingMeta === 'object' && !Array.isArray(existingMeta)
      ? { ...(existingMeta as Record<string, unknown>) }
      : {};
  const prev = (meta['inboundDebounce'] as Record<string, unknown> | undefined) ?? {};
  const cur =
    typeof prev['pendingVersion'] === 'number' && Number.isFinite(prev['pendingVersion'])
      ? prev['pendingVersion']
      : 0;
  const newVersion = cur + 1;
  meta['inboundDebounce'] = {
    ...prev,
    pendingVersion: newVersion,
    lastScheduledAt: new Date().toISOString(),
  };
  return { merged: meta, newVersion };
}

/** True when the delayed job should exit because a newer inbound bumped the version. */
export function shouldSkipStaleDebounceJob(conversationMetadata: unknown, jobVersion: number): boolean {
  if (!conversationMetadata || typeof conversationMetadata !== 'object') return true;
  const o = conversationMetadata as Record<string, unknown>;
  const d = o['inboundDebounce'];
  if (!d || typeof d !== 'object') return true;
  const pending = (d as Record<string, unknown>)['pendingVersion'];
  if (typeof pending !== 'number' || !Number.isFinite(pending)) return true;
  return pending !== jobVersion;
}
