import { describe, it, expect } from '@jest/globals';
import {
  channelFromDerivedConversationKey,
  deriveConversationIdentity,
  isDerivedConversationKey,
} from './conversation-identity';

describe('deriveConversationIdentity', () => {
  it('uses provider conversation id when present (no derivation)', () => {
    const out = deriveConversationIdentity({
      tenantId: 't1',
      channel: 'WHATSAPP',
      externalContactId: 'ct1',
      externalConversationId: 'conv-abc',
    });
    expect(out.externalConversationId).toBe('conv-abc');
    expect(out.preferredExternalId).toBe('conv-abc');
    expect(out.derivedFromContact).toBe(false);
    expect(out.derivedConversationKey).toMatch(/^aisbp:conv:whatsapp:t1:ct1$/);
    expect(out.derivedKeyHash).toMatch(/^[a-f0-9]{12}$/);
  });

  it('derives a stable key from tenant + channel + contact when external id is missing', () => {
    const a = deriveConversationIdentity({
      tenantId: 't1',
      channel: 'whatsapp',
      externalContactId: 'ct1',
    });
    const b = deriveConversationIdentity({
      tenantId: 't1',
      channel: 'WHATSAPP',
      externalContactId: 'ct1',
      externalConversationId: '',
    });
    expect(a.derivedConversationKey).toBe(b.derivedConversationKey);
    expect(a.derivedFromContact).toBe(true);
    expect(b.derivedFromContact).toBe(true);
    expect(a.preferredExternalId).toBe(a.derivedConversationKey);
  });

  it('different tenants do not collide on the same contactId', () => {
    const a = deriveConversationIdentity({ tenantId: 't1', externalContactId: 'ctA', channel: 'whatsapp' });
    const b = deriveConversationIdentity({ tenantId: 't2', externalContactId: 'ctA', channel: 'whatsapp' });
    expect(a.derivedConversationKey).not.toBe(b.derivedConversationKey);
  });

  it('isDerivedConversationKey detects our prefix', () => {
    const out = deriveConversationIdentity({ tenantId: 't1', externalContactId: 'ct1' });
    expect(isDerivedConversationKey(out.derivedConversationKey)).toBe(true);
    expect(isDerivedConversationKey('conv-from-ghl')).toBe(false);
    expect(isDerivedConversationKey(null)).toBe(false);
  });

  it('channelFromDerivedConversationKey reads identity segment', () => {
    expect(channelFromDerivedConversationKey('aisbp:conv:instagram:t1:ct1')).toBe('instagram');
    expect(channelFromDerivedConversationKey('aisbp:conv:facebook:t1:ct1')).toBe('facebook');
    expect(channelFromDerivedConversationKey('conv-from-ghl')).toBeNull();
  });

  it('throws when tenant or contact id is missing', () => {
    expect(() =>
      deriveConversationIdentity({ tenantId: '', externalContactId: 'ct' }),
    ).toThrow();
    expect(() =>
      deriveConversationIdentity({ tenantId: 't1', externalContactId: ' ' }),
    ).toThrow();
  });
});
