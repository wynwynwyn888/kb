import {
  formatHandoverChannelLabel,
  formatHandoverContactSummary,
  formatHandoverReasonLabel,
  formatHandoverTypeLabel,
} from './handover-display';

describe('handover-display', () => {
  it('maps REQUEST to Human request', () => {
    expect(formatHandoverTypeLabel('REQUEST')).toBe('Human request');
  });

  it('maps SMS channel to WhatsApp label', () => {
    expect(formatHandoverChannelLabel({ dbChannel: 'SMS' })).toBe('WhatsApp');
  });

  it('maps CHAT + facebook metadata to Facebook Messenger', () => {
    expect(
      formatHandoverChannelLabel({
        dbChannel: 'CHAT',
        metadata: { ghlOutboundChannel: 'FACEBOOK' },
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
});
