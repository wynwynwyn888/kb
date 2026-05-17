import {
  formatHandoverChannelLabel,
  formatHandoverContactSummary,
  formatInternalEscalationCustomerLines,
  formatHandoverReasonLabel,
  formatHandoverTypeLabel,
} from './handover-display';

describe('handover-display', () => {
  it('maps REQUEST to Human request', () => {
    expect(formatHandoverTypeLabel('REQUEST')).toBe('Human request');
  });

  it('maps SMS channel to WhatsApp when no Meta signals', () => {
    expect(formatHandoverChannelLabel({ dbChannel: 'SMS' })).toBe('WhatsApp');
  });

  it('maps metadata ghlOutboundChannel INSTAGRAM to Instagram label', () => {
    expect(
      formatHandoverChannelLabel({
        dbChannel: 'SMS',
        metadata: { ghlOutboundChannel: 'INSTAGRAM', channelIdentity: 'instagram' },
      }),
    ).toBe('Instagram');
  });

  it('maps CHAT + facebook metadata to Facebook Messenger', () => {
    expect(
      formatHandoverChannelLabel({
        dbChannel: 'CHAT',
        metadata: { ghlOutboundChannel: 'FACEBOOK' },
      }),
    ).toBe('Facebook Messenger');
  });

  it('uses derived conversation key for Instagram', () => {
    expect(
      formatHandoverChannelLabel({
        dbChannel: 'SMS',
        ghlConversationId: 'aisbp:conv:instagram:tenant-1:contact-abc',
      }),
    ).toBe('Instagram');
  });

  it('infers Instagram from GHL contact when channel is SMS', () => {
    expect(
      formatHandoverChannelLabel({
        dbChannel: 'SMS',
        contact: { instagramId: 'ig-user-123', firstName: 'Daphne' },
      }),
    ).toBe('Instagram');
  });

  it('infers Facebook from GHL contact when channel is SMS', () => {
    expect(
      formatHandoverChannelLabel({
        dbChannel: 'SMS',
        contact: { facebookId: 'fb-user-456', firstName: 'Daphne' },
      }),
    ).toBe('Facebook Messenger');
  });

  it('shows name and phone for WhatsApp', () => {
    expect(
      formatHandoverContactSummary({
        displayName: 'Sam Lee',
        phone: '+6512345678',
        channelLabel: 'WhatsApp',
      }),
    ).toBe('Sam Lee · +6512345678');
  });

  it('shows name only for Instagram', () => {
    expect(
      formatHandoverContactSummary({
        displayName: 'Alex',
        phone: '+6512345678',
        channelLabel: 'Instagram',
      }),
    ).toBe('Alex');
  });

  it('replaces human_intent note with Human escalation', () => {
    expect(formatHandoverReasonLabel('human_intent:HUMAN_HANDOVER')).toBe('Human escalation');
  });

  it('formats WhatsApp internal alert with phone and channel', () => {
    expect(
      formatInternalEscalationCustomerLines({
        customerName: 'Sam',
        phone: '+6512345678',
        channelSlug: 'whatsapp',
      }),
    ).toBe('Customer: Sam\nPhone: +6512345678\nChannel: whatsapp');
  });

  it('formats Facebook internal alert without phone line', () => {
    expect(
      formatInternalEscalationCustomerLines({
        customerName: 'Daphne Wong',
        phone: null,
        channelSlug: 'facebook',
      }),
    ).toBe('Customer: Daphne Wong\nChannel: facebook');
  });
});
