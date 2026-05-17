import { normalizeGhlInboundChannel, resolveOutboundChannelForSend } from './ghl-channel-routing';

describe('ghl-channel-routing', () => {
  it('maps facebook messenger inbound to FACEBOOK outbound', () => {
    const n = normalizeGhlInboundChannel('facebook');
    expect(n.dbChannel).toBe('CHAT');
    expect(n.outboundChannel).toBe('FACEBOOK');
    expect(n.identityChannel).toBe('facebook');
  });

  it('maps instagram inbound to INSTAGRAM outbound', () => {
    const n = normalizeGhlInboundChannel('instagram');
    expect(n.dbChannel).toBe('CHAT');
    expect(n.outboundChannel).toBe('INSTAGRAM');
  });

  it('prefers metadata ghlOutboundChannel for send', () => {
    expect(
      resolveOutboundChannelForSend({
        dbChannel: 'WHATSAPP',
        metadata: { ghlOutboundChannel: 'FACEBOOK' },
      }),
    ).toBe('FACEBOOK');
  });
});
