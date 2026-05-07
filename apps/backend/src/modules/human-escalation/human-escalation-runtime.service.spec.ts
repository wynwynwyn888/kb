import { jest as jestGlobal } from '@jest/globals';

const mockSupabaseFrom = jestGlobal.fn();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: mockSupabaseFrom,
  }),
}));

import { HumanEscalationRuntimeService } from './human-escalation-runtime.service';

describe('HumanEscalationRuntimeService', () => {
  const conversations = {
    isInHandover: jestGlobal.fn(async () => false),
    pauseForHandover: jestGlobal.fn(async () => 'he_1'),
  };

  const followUpEngine = {
    cancelPendingJobsForHumanEscalation: jestGlobal.fn(async () => {}),
  };

  const escalationSettings = {
    getSettings: jestGlobal.fn(async () => ({
      enabled: false,
      teamNotificationNumber: null,
      optionalMessagePrefix: null,
    })),
  };

  const notify = {
    sendInternalAlert: jestGlobal.fn(async () => 'skipped_disabled' as const),
  };

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { metadata: {} },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      return {};
    });
  });

  it('pauses handover and cancels follow-ups on first human intent', async () => {
    conversations.isInHandover.mockResolvedValueOnce(false);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: false,
      teamNotificationNumber: null,
      optionalMessagePrefix: null,
    });

    const svc = new HumanEscalationRuntimeService(
      conversations as never,
      followUpEngine as never,
      escalationSettings as never,
      notify as never,
    );

    await svc.onHumanHandoverIntent({
      tenantId: 't1',
      tenantDisplayName: 'Acme',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'I want to speak to a human',
      memoryEntries: [],
      contactPhone: '+10000000000',
      contactDisplayName: 'Sam',
    });

    expect(conversations.pauseForHandover).toHaveBeenCalledWith(
      'c1',
      'REQUEST',
      'AI',
      'human_intent:HUMAN_HANDOVER',
    );
    expect(followUpEngine.cancelPendingJobsForHumanEscalation).toHaveBeenCalledWith({
      tenantId: 't1',
      conversationId: 'c1',
    });
    expect(notify.sendInternalAlert).not.toHaveBeenCalled();
  });

  it('when escalation enabled with number, sends internal alert', async () => {
    conversations.isInHandover.mockResolvedValueOnce(false);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: true,
      teamNotificationNumber: '+6512345678',
      optionalMessagePrefix: '[Test]',
    });
    notify.sendInternalAlert.mockResolvedValueOnce('sent');

    const svc = new HumanEscalationRuntimeService(
      conversations as never,
      followUpEngine as never,
      escalationSettings as never,
      notify as never,
    );

    await svc.onHumanHandoverIntent({
      tenantId: 't1',
      tenantDisplayName: 'Acme',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'Human please',
      memoryEntries: [],
      contactPhone: '+19999999999',
      contactDisplayName: null,
    });

    expect(notify.sendInternalAlert).toHaveBeenCalled();
    const arg = notify.sendInternalAlert.mock.calls[0]![0];
    expect(arg.enabled).toBe(true);
    expect(arg.teamNotificationNumber).toBe('+6512345678');
    expect(String(arg.messageBody)).toContain('Human please');
  });

  it('when enabled but no team number, does not call notify', async () => {
    conversations.isInHandover.mockResolvedValueOnce(false);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: true,
      teamNotificationNumber: null,
      optionalMessagePrefix: null,
    });

    const svc = new HumanEscalationRuntimeService(
      conversations as never,
      followUpEngine as never,
      escalationSettings as never,
      notify as never,
    );

    await svc.onHumanHandoverIntent({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'agent',
      memoryEntries: [],
      contactPhone: null,
      contactDisplayName: null,
    });

    expect(notify.sendInternalAlert).not.toHaveBeenCalled();
  });

  it('does not create duplicate handover pause when already in handover', async () => {
    conversations.isInHandover.mockResolvedValueOnce(true);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: false,
      teamNotificationNumber: null,
      optionalMessagePrefix: null,
    });

    const svc = new HumanEscalationRuntimeService(
      conversations as never,
      followUpEngine as never,
      escalationSettings as never,
      notify as never,
    );

    await svc.onHumanHandoverIntent({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'human',
      memoryEntries: [],
      contactPhone: null,
      contactDisplayName: null,
    });

    expect(conversations.pauseForHandover).not.toHaveBeenCalled();
    expect(followUpEngine.cancelPendingJobsForHumanEscalation).toHaveBeenCalled();
  });
});
