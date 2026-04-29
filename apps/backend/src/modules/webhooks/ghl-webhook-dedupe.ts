import { createHash } from 'crypto';
import type { GhlWebhookPayload } from './dto/ghl-webhook.payload';

/** How duplicate detection was derived (for logs only). */
export type GhlInboundDedupeReason = 'provider_event_id' | 'provider_payload_hash';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => stableStringify(v)).join(',')}]`;
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

function hashPayload(payload: GhlWebhookPayload): string {
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex').slice(0, 40);
}

/**
 * Tier 1: `data.id` (GHL message id) — duplicate **provider delivery** of the same message.
 * Tier 2+: stable hash of the **entire** normalized webhook JSON — identical byte-level replay
 * dedupes; same human text at a different time (different timestamp / envelope) is **not**
 * deduped. Never dedupe on message body alone.
 */
export function extractGhlInboundDedupeKeys(payload: GhlWebhookPayload): {
  externalEventId: string;
  dedupeKey: string;
  dedupeReason: GhlInboundDedupeReason;
} {
  const data = payload.data || {};

  if (data.id) {
    return {
      externalEventId: data.id,
      dedupeKey: `tier1:${data.id}`,
      dedupeReason: 'provider_event_id',
    };
  }

  const h = hashPayload(payload);
  return {
    externalEventId: `GHL|payload|${h}`,
    dedupeKey: `tier2:${h}`,
    dedupeReason: 'provider_payload_hash',
  };
}
