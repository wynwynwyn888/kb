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
});
