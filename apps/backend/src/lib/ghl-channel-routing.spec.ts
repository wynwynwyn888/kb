import {
  ghlOutboundFallbackChannels,
  isGhlMissingMetaChannelIdError,
  isGhlMissingPhoneSendError,
  isGhlOutboundChannelRetryable,
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

  it('infers INSTAGRAM from contact instagramId when channel is SMS', () => {
    const n = resolveGhlInboundChannel({
      channelRaw: 'SMS',
      messageTypeRaw: 'TextMessage',
      contactPhone: '',
      workflowFlatRaw: {
        contact: { instagramId: 'ig-user-123' },
      },
    });
    expect(n.outboundChannel).toBe('INSTAGRAM');
    expect(n.source).toBe('contact_instagram_id');
    expect(n.identityChannel).toBe('instagram');
  });

  it('infers INSTAGRAM from workflow messageSource hint', () => {
    const n = resolveGhlInboundChannel({
      channelRaw: 'SMS',
      messageTypeRaw: 'TextMessage',
      contactPhone: '',
      workflowFlatRaw: {
        message: { messageSource: 'instagram' },
      },
    });
    expect(n.outboundChannel).toBe('INSTAGRAM');
    expect(n.source).toBe('workflow_channel_hint_ig');
  });

  it('infers FACEBOOK when GHL sends channel SMS with no contact phone and no IG hints', () => {
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

  it('detects missing Meta channel id GHL errors', () => {
    expect(isGhlMissingMetaChannelIdError('Contact has no Facebook id, skipping')).toBe(true);
    expect(isGhlOutboundChannelRetryable('Contact has no Facebook id, skipping')).toBe(true);
  });

  it('lists Meta fallbacks after SMS and cross-fallback FB/IG', () => {
    expect(ghlOutboundFallbackChannels('SMS')).toEqual(['SMS', 'FACEBOOK', 'INSTAGRAM']);
    expect(ghlOutboundFallbackChannels('FACEBOOK')).toEqual(['FACEBOOK', 'INSTAGRAM']);
    expect(ghlOutboundFallbackChannels('INSTAGRAM')).toEqual(['INSTAGRAM', 'FACEBOOK']);
  });
});
