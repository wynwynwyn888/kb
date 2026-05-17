import {
  ghlOutboundFallbackChannels,
  isGhlMissingPhoneSendError,
  normalizeGhlInboundChannel,
  resolveGhlInboundChannel,
  resolveOutboundChannelForSend,
} from './ghl-channel-routing';

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

  it('infers FACEBOOK from TYPE_FACEBOOK messageType even when channel is SMS', () => {
    const n = resolveGhlInboundChannel({
      channelRaw: 'SMS',
      messageTypeRaw: 'TYPE_FACEBOOK',
    });
    expect(n.outboundChannel).toBe('FACEBOOK');
    expect(n.source).toBe('messageType');
  });

  it('infers FACEBOOK when GHL sends channel SMS with no contact phone', () => {
    const n = resolveGhlInboundChannel({
      channelRaw: 'SMS',
      messageTypeRaw: 'text',
      contactPhone: '',
    });
    expect(n.outboundChannel).toBe('FACEBOOK');
    expect(n.source).toBe('sms_channel_no_phone');
  });

  it('prefers metadata ghlOutboundChannel for send', () => {
    expect(
      resolveOutboundChannelForSend({
        dbChannel: 'WHATSAPP',
        metadata: { ghlOutboundChannel: 'FACEBOOK' },
      }),
    ).toBe('FACEBOOK');
  });

  it('detects missing phone GHL errors', () => {
    expect(isGhlMissingPhoneSendError('Missing phone number')).toBe(true);
  });

  it('lists Meta fallbacks after SMS', () => {
    expect(ghlOutboundFallbackChannels('SMS')).toEqual(['SMS', 'FACEBOOK', 'INSTAGRAM']);
  });
});
