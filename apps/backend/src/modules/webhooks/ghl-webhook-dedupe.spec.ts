import { extractGhlInboundDedupeKeys } from './ghl-webhook-dedupe';
import type { GhlWebhookPayload } from './dto/ghl-webhook.payload';

function makePayload(msg: string, id?: string): GhlWebhookPayload {
  return {
    locationId: 'loc1',
    event: 'InboundMessage',
    timestamp: '2026-04-26T12:00:00.000Z',
    data: {
      conversationId: 'conv1',
      contactId: 'c1',
      message: msg,
      messageType: 'text',
      ...(id ? { id } : {}),
    },
  };
}

describe('ghl-webhook-dedupe', () => {
  it('uses message id tier1 when present', () => {
    const p = makePayload('ignored', 'msg-99');
    const k = extractGhlInboundDedupeKeys(p);
    expect(k.externalEventId).toBe('msg-99');
    expect(k.dedupeKey).toBe('tier1:msg-99');
    expect(k.dedupeReason).toBe('provider_event_id');
  });

  it('tier2 hash path when no message id', () => {
    const k = extractGhlInboundDedupeKeys(makePayload('first'));
    expect(k.dedupeKey.startsWith('tier2:')).toBe(true);
    expect(k.externalEventId.startsWith('GHL|payload|')).toBe(true);
    expect(k.dedupeReason).toBe('provider_payload_hash');
  });

  it('tier2 external id differs when message body differs (same timestamp + conversation, no message id)', () => {
    const a = extractGhlInboundDedupeKeys(makePayload('first'));
    const b = extractGhlInboundDedupeKeys(makePayload('second message'));
    expect(a.externalEventId).not.toBe(b.externalEventId);
    expect(a.dedupeKey.startsWith('tier2:')).toBe(true);
    expect(b.dedupeKey.startsWith('tier2:')).toBe(true);
  });

  it('identical full payload yields same dedupe key (provider replay duplicate)', () => {
    const p = makePayload('same text');
    const a = extractGhlInboundDedupeKeys(p);
    const b = extractGhlInboundDedupeKeys(makePayload('same text'));
    expect(a.externalEventId).toBe(b.externalEventId);
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });

  it('same message body but different timestamp => different provider events (customer repeated text)', () => {
    const base: GhlWebhookPayload = {
      locationId: 'loc1',
      event: 'InboundMessage',
      data: {
        conversationId: 'conv1',
        contactId: 'c1',
        message: 'how much is haircut?',
        messageType: 'text',
      },
    };
    const a = extractGhlInboundDedupeKeys({ ...base, timestamp: '2026-04-26T12:00:00.000Z' });
    const b = extractGhlInboundDedupeKeys({ ...base, timestamp: '2026-04-26T12:00:05.000Z' });
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });

  it('same text with different message ids => different tier1 keys', () => {
    const a = extractGhlInboundDedupeKeys(makePayload('how much is haircut?', 'm1'));
    const b = extractGhlInboundDedupeKeys(makePayload('how much is haircut?', 'm2'));
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
    expect(a.dedupeReason).toBe('provider_event_id');
    expect(b.dedupeReason).toBe('provider_event_id');
  });

  it('payload hash is stable when JSON key order differs', () => {
    const base = {
      locationId: 'loc1',
      event: 'InboundMessage',
      timestamp: '2026-04-26T12:00:00.000Z',
      data: {
        conversationId: 'conv1',
        contactId: 'c1',
        message: 'hello',
        messageType: 'text',
      },
    } satisfies GhlWebhookPayload;
    const reordered: GhlWebhookPayload = {
      event: base.event,
      locationId: base.locationId,
      timestamp: base.timestamp,
      data: {
        messageType: base.data.messageType,
        message: base.data.message,
        contactId: base.data.contactId,
        conversationId: base.data.conversationId,
      },
    };
    expect(extractGhlInboundDedupeKeys(base).dedupeKey).toBe(extractGhlInboundDedupeKeys(reordered).dedupeKey);
  });
});
