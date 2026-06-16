/**
 * Safe merge when persisting conversation metadata from a stale orchestration snapshot.
 * Preserves newer inbound debounce versions and escalation flags not present in the snapshot.
 */

function asMetaRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

function inboundDebounceVersion(meta: Record<string, unknown>): number {
  const d = meta['inboundDebounce'];
  if (!d || typeof d !== 'object') return 0;
  const v = (d as Record<string, unknown>)['pendingVersion'];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Merge `incoming` (from stale snapshot) onto `current` (fresh DB read). */
export function mergeConversationMetadataForPersist(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };

  if (inboundDebounceVersion(current) >= inboundDebounceVersion(incoming)) {
    if (current['inboundDebounce'] !== undefined) {
      merged['inboundDebounce'] = current['inboundDebounce'];
    }
  } else if (incoming['inboundDebounce'] !== undefined) {
    merged['inboundDebounce'] = incoming['inboundDebounce'];
  }

  if (
    current['humanEscalationPendingInternalAlert'] &&
    !incoming['humanEscalationPendingInternalAlert']
  ) {
    merged['humanEscalationPendingInternalAlert'] = current['humanEscalationPendingInternalAlert'];
  }

  if (incoming['aisbp_policy'] !== undefined) {
    merged['aisbp_policy'] = incoming['aisbp_policy'];
  }
  if (incoming['aisbp_booking'] !== undefined) {
    merged['aisbp_booking'] = incoming['aisbp_booking'];
  }

  const reserved = new Set([
    'inboundDebounce',
    'humanEscalationPendingInternalAlert',
    'aisbp_policy',
    'aisbp_booking',
  ]);
  for (const [key, value] of Object.entries(incoming)) {
    if (!reserved.has(key)) {
      merged[key] = value;
    }
  }

  return merged;
}

export function readConversationMetadataField(raw: unknown): Record<string, unknown> {
  return asMetaRecord(raw);
}
