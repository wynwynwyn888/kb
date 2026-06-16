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

function followUpScheduleVersion(meta: Record<string, unknown>): number {
  const v = meta['followUpScheduleVersion'];
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
}

function bookingMergeRank(meta: Record<string, unknown>): { version: number; confirmedRank: number; confirmedAt: number } {
  const b = meta['aisbp_booking'];
  if (!b || typeof b !== 'object') {
    return { version: 0, confirmedRank: 0, confirmedAt: 0 };
  }
  const o = b as Record<string, unknown>;
  const version = typeof o['version'] === 'number' && Number.isFinite(o['version']) ? Math.floor(o['version']) : 0;
  const status = typeof o['status'] === 'string' ? o['status'] : '';
  const confirmedRank = status === 'confirmed' ? 2 : status === 'creating' ? 1 : 0;
  const confirmedAtRaw = typeof o['bookingConfirmedAt'] === 'string' ? Date.parse(o['bookingConfirmedAt']) : 0;
  const confirmedAt = Number.isFinite(confirmedAtRaw) ? confirmedAtRaw : 0;
  return { version, confirmedRank, confirmedAt };
}

/** Prefer fresher booking state when versions tie (confirmed beats in-flight intake). */
function shouldPreferCurrentBookingState(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): boolean {
  const cur = bookingMergeRank(current);
  const inc = bookingMergeRank(incoming);
  if (cur.confirmedRank > inc.confirmedRank) return true;
  if (inc.confirmedRank > cur.confirmedRank) return false;
  if (inc.version > cur.version) return false;
  if (inc.version < cur.version) return true;
  if (cur.confirmedAt > inc.confirmedAt) return true;
  if (inc.confirmedAt > cur.confirmedAt) return false;
  return false;
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

  if (incoming['humanEscalationPendingInternalAlert'] !== undefined) {
    merged['humanEscalationPendingInternalAlert'] = incoming['humanEscalationPendingInternalAlert'];
  } else if (current['humanEscalationPendingInternalAlert']) {
    merged['humanEscalationPendingInternalAlert'] = current['humanEscalationPendingInternalAlert'];
  }

  if (incoming['aisbp_policy'] !== undefined) {
    merged['aisbp_policy'] = incoming['aisbp_policy'];
  }
  if (incoming['aisbp_booking'] !== undefined) {
    if (
      current['aisbp_booking'] !== undefined &&
      shouldPreferCurrentBookingState(current, incoming)
    ) {
      merged['aisbp_booking'] = current['aisbp_booking'];
    } else {
      merged['aisbp_booking'] = incoming['aisbp_booking'];
    }
  } else if (current['aisbp_booking'] !== undefined) {
    merged['aisbp_booking'] = current['aisbp_booking'];
  }

  const fuCur = followUpScheduleVersion(current);
  const fuInc = followUpScheduleVersion(incoming);
  if (fuCur >= fuInc) {
    if (current['followUpScheduleVersion'] !== undefined) {
      merged['followUpScheduleVersion'] = current['followUpScheduleVersion'];
    }
    if (current['followUpScheduleVersionUpdatedAt'] !== undefined) {
      merged['followUpScheduleVersionUpdatedAt'] = current['followUpScheduleVersionUpdatedAt'];
    }
    if (current['followUpScheduleVersionReason'] !== undefined) {
      merged['followUpScheduleVersionReason'] = current['followUpScheduleVersionReason'];
    }
  } else {
    if (incoming['followUpScheduleVersion'] !== undefined) {
      merged['followUpScheduleVersion'] = incoming['followUpScheduleVersion'];
    }
    if (incoming['followUpScheduleVersionUpdatedAt'] !== undefined) {
      merged['followUpScheduleVersionUpdatedAt'] = incoming['followUpScheduleVersionUpdatedAt'];
    }
    if (incoming['followUpScheduleVersionReason'] !== undefined) {
      merged['followUpScheduleVersionReason'] = incoming['followUpScheduleVersionReason'];
    }
  }

  const reserved = new Set([
    'inboundDebounce',
    'humanEscalationPendingInternalAlert',
    'aisbp_policy',
    'aisbp_booking',
    'followUpScheduleVersion',
    'followUpScheduleVersionUpdatedAt',
    'followUpScheduleVersionReason',
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
