import { createHash } from 'crypto';
import type { GhlWebhookPayload } from './dto/ghl-webhook.payload';

/** Fingerprint inbound body so tier-2 keys differ when GHL omits message id but reuses timestamp. */
export function fingerprintInboundMessage(message: string | undefined): string {
  const m = (message ?? '').trim();
  if (!m) return 'nomsg';
  return createHash('sha256').update(m, 'utf8').digest('hex').slice(0, 20);
}

/**
 * Tier 1: data.id (GHL message id).
 * Tier 2: location + conversation/contact + event + timestamp + **message fingerprint** (fixes workflow duplicate false positives).
 * Tier 3: hash of sparse fields (unchanged shape, message already in hash).
 */
export function extractGhlInboundDedupeKeys(payload: GhlWebhookPayload): {
  externalEventId: string;
  dedupeKey: string;
} {
  const data = payload.data || {};
  const msgFp = fingerprintInboundMessage(data.message);

  if (data.id) {
    return {
      externalEventId: data.id,
      dedupeKey: `tier1:${data.id}`,
    };
  }

  const locationId = payload.locationId;
  const conversationId = data.conversationId;
  const contactId = data.contactId;
  const eventType = payload.event;
  const timestamp = payload.timestamp;

  if (conversationId) {
    const tier2Key = `GHL|${locationId}|${conversationId}|${eventType}|${timestamp}|${msgFp}`;
    return {
      externalEventId: tier2Key,
      dedupeKey: `tier2:${tier2Key}`,
    };
  }

  if (contactId) {
    const tier2Key = `GHL|${locationId}|${contactId}|${eventType}|${timestamp}|${msgFp}`;
    return {
      externalEventId: tier2Key,
      dedupeKey: `tier2:${tier2Key}`,
    };
  }

  const components = [
    locationId,
    conversationId || '',
    data.message || '',
    data.messageType || '',
    timestamp,
  ].join('|');

  const hash = createHash('sha256').update(components, 'utf8').digest('hex').substring(0, 32);

  return {
    externalEventId: hash,
    dedupeKey: `tier3:${hash}`,
  };
}
