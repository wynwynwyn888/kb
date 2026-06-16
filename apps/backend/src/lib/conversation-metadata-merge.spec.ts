import { mergeConversationMetadataForPersist } from './conversation-metadata-merge';

describe('mergeConversationMetadataForPersist', () => {
  it('keeps newer inboundDebounce from current DB row', () => {
    const current = {
      inboundDebounce: { pendingVersion: 5, lastScheduledAt: 't2' },
      aisbp_booking: { status: 'collecting_details', calendarId: 'c1', version: 1 },
    };
    const incoming = {
      inboundDebounce: { pendingVersion: 3, lastScheduledAt: 't1' },
      aisbp_booking: { status: 'confirmed', calendarId: 'c1', version: 1 },
    };
    const merged = mergeConversationMetadataForPersist(current, incoming);
    expect((merged['inboundDebounce'] as { pendingVersion: number }).pendingVersion).toBe(5);
    expect((merged['aisbp_booking'] as { status: string }).status).toBe('confirmed');
  });

  it('preserves pending internal escalation alert when incoming omits it', () => {
    const alert = { summary: 'help', latestInboundMessage: 'human please' };
    const current = { humanEscalationPendingInternalAlert: alert };
    const incoming = { aisbp_booking: { status: 'offered_slots', calendarId: 'c1', version: 1 } };
    const merged = mergeConversationMetadataForPersist(current, incoming);
    expect(merged['humanEscalationPendingInternalAlert']).toEqual(alert);
  });

  it('preserves higher-version confirmed booking from current DB row', () => {
    const current = {
      aisbp_booking: {
        status: 'confirmed',
        calendarId: 'c1',
        version: 3,
        appointmentId: 'ap1',
        bookingConfirmedAt: '2026-06-01T10:00:00.000Z',
      },
    };
    const incoming = {
      aisbp_booking: { status: 'offered_slots', calendarId: 'c1', version: 2 },
    };
    const merged = mergeConversationMetadataForPersist(current, incoming);
    expect((merged['aisbp_booking'] as { status: string; version: number }).status).toBe('confirmed');
    expect((merged['aisbp_booking'] as { version: number }).version).toBe(3);
  });

  it('preserves confirmed booking when incoming has higher version but lower status rank', () => {
    const current = {
      aisbp_booking: {
        status: 'confirmed',
        calendarId: 'c1',
        version: 2,
        appointmentId: 'ap1',
      },
    };
    const incoming = {
      aisbp_booking: { status: 'creating', calendarId: 'c1', version: 5 },
    };
    const merged = mergeConversationMetadataForPersist(current, incoming);
    expect((merged['aisbp_booking'] as { status: string }).status).toBe('confirmed');
  });

  it('preserves current booking when incoming omits aisbp_booking', () => {
    const current = { aisbp_booking: { status: 'confirmed', calendarId: 'c1', version: 2 } };
    const incoming = { outboundChannel: 'SMS' };
    const merged = mergeConversationMetadataForPersist(current, incoming);
    expect((merged['aisbp_booking'] as { status: string }).status).toBe('confirmed');
    expect(merged['outboundChannel']).toBe('SMS');
  });
});
