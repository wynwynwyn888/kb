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
  });

  it('tier2 external id differs when message body differs (same timestamp + conversation, no message id)', () => {
    const a = extractGhlInboundDedupeKeys(makePayload('first'));
    const b = extractGhlInboundDedupeKeys(makePayload('second message'));
    expect(a.externalEventId).not.toBe(b.externalEventId);
    expect(a.dedupeKey.startsWith('tier2:')).toBe(true);
    expect(b.dedupeKey.startsWith('tier2:')).toBe(true);
  });

  it('G: identical tier2 payload yields same dedupe key (real duplicate)', () => {
    const p = makePayload('same text');
    const a = extractGhlInboundDedupeKeys(p);
    const b = extractGhlInboundDedupeKeys(makePayload('same text'));
    expect(a.externalEventId).toBe(b.externalEventId);
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});
