import {
  ghlOutboundExpandChannelAttempts,
  ghlOutboundFallbackChannels,
  isGhlMissingMetaChannelIdError,
  isGhlMissingPhoneSendError,
  normalizeGhlInboundChannel,
  resolveGhlInboundChannel,
  resolveOutboundChannelForSend,
} from './ghl-channel-routing';
import type { OutboundChannel } from '@aisbp/ghl-client';

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

  it('keeps true SMS when channel is SMS and no Meta hints (even without webhook phone)', () => {
    const n = resolveGhlInboundChannel({
      channelRaw: 'SMS',
      messageTypeRaw: 'TextMessage',
      contactPhone: '',
    });
    expect(n.outboundChannel).toBe('SMS');
    expect(n.dbChannel).toBe('SMS');
    expect(n.identityChannel).toBe('sms');
    expect(n.source).toBe('channel_field');
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

  it('infers FACEBOOK from nested workflow messageType', () => {
    const n = resolveGhlInboundChannel({
      channelRaw: 'SMS',
      messageTypeRaw: 'TextMessage',
      workflowFlatRaw: {
        customData: { message: { messageType: 'TYPE_FACEBOOK' } },
      },
    });
    expect(n.outboundChannel).toBe('FACEBOOK');
    expect(n.source).toBe('messageType');
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
  });

  it('SMS outbound attempts only SMS until missing-phone expansion', () => {
    expect(ghlOutboundFallbackChannels('SMS')).toEqual(['SMS']);
    const queue: OutboundChannel[] = ['SMS'];
    ghlOutboundExpandChannelAttempts('SMS', 'SMS', 'Missing phone number', queue);
    expect(queue).toEqual(['SMS', 'FACEBOOK', 'INSTAGRAM']);
  });

  it('cross-fallback FB/IG for Meta primaries', () => {
    expect(ghlOutboundFallbackChannels('FACEBOOK')).toEqual(['FACEBOOK', 'INSTAGRAM']);
    expect(ghlOutboundFallbackChannels('INSTAGRAM')).toEqual(['INSTAGRAM', 'FACEBOOK']);
  });
});
