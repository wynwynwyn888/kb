import { jest as jestGlobal } from '@jest/globals';

const mockSupabaseFrom = jestGlobal.fn();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: mockSupabaseFrom,
  }),
}));

import { HumanEscalationRuntimeService, AI_NEEDS_HUMAN_REVIEW_TAG } from './human-escalation-runtime.service';

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

  const tagContact = jestGlobal.fn(async () => ({ success: true as const }));
  const listTags = jestGlobal.fn(async () => ({
    error: null as const,
    tags: [{ name: AI_NEEDS_HUMAN_REVIEW_TAG }],
  }));
  const getContact = jestGlobal.fn(async () => ({
    success: false as const,
    contact: undefined as undefined,
  }));

  const ghlService = {
    createGhlClientForConnectedTenantWorkerOrThrow: jestGlobal.fn(async () => ({
      client: { listTags, tagContact, getContact },
      ghlLocationId: 'loc1',
    })),
  };

  const generation = {
    generateDraft: jestGlobal.fn(async () => ({
      content: 'The customer asked to speak with a human after asking about the menu.',
    })),
  };

  function makeDefaultConversationsTableMock() {
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

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    listTags.mockResolvedValue({
      error: null as const,
      tags: [{ name: AI_NEEDS_HUMAN_REVIEW_TAG }],
    });
    getContact.mockResolvedValue({ success: false as const, contact: undefined });
    generation.generateDraft.mockResolvedValue({
      content: 'The customer asked to speak with a human after asking about the menu.',
    });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return makeDefaultConversationsTableMock();
      }
      return {};
    });
  });

  function makeSvc() {
    return new HumanEscalationRuntimeService(
      conversations as never,
      followUpEngine as never,
      escalationSettings as never,
      notify as never,
      ghlService as never,
      generation as never,
    );
  }

  it('does not pause handover when escalation is disabled in settings', async () => {
    conversations.isInHandover.mockResolvedValueOnce(false);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: false,
      teamNotificationNumber: null,
      optionalMessagePrefix: null,
    });

    const result = await makeSvc().onHumanHandoverIntent({
      tenantId: 't1',
      tenantDisplayName: 'Acme',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'I want to speak to a human',
      memoryEntries: [],
      contactPhone: '+10000000000',
      contactDisplayName: 'Sam',
    });

    expect(result.escalated).toBe(false);
    expect(conversations.pauseForHandover).not.toHaveBeenCalled();
    expect(followUpEngine.cancelPendingJobsForHumanEscalation).not.toHaveBeenCalled();
    expect(notify.sendInternalAlert).not.toHaveBeenCalled();
    expect(tagContact).not.toHaveBeenCalled();
  });

  it('pauses handover and cancels follow-ups when escalation is enabled', async () => {
    conversations.isInHandover.mockResolvedValueOnce(false);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: true,
      teamNotificationNumber: '+6512345678',
      optionalMessagePrefix: null,
    });

    const result = await makeSvc().onHumanHandoverIntent({
      tenantId: 't1',
      tenantDisplayName: 'Acme',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'I want to speak to a human',
      memoryEntries: [],
      contactPhone: '+10000000000',
      contactDisplayName: 'Sam',
    });

    expect(result.escalated).toBe(true);
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
    expect(tagContact).toHaveBeenCalledWith({
      contactId: 'ct1',
      tags: [AI_NEEDS_HUMAN_REVIEW_TAG],
    });
  });

  it('when escalation enabled with number, sends internal alert with CRM-style body', async () => {
    conversations.isInHandover.mockResolvedValueOnce(false);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: true,
      teamNotificationNumber: '+6512345678',
      optionalMessagePrefix: '[Test]',
    });
    notify.sendInternalAlert.mockResolvedValueOnce('sent');
    getContact.mockResolvedValueOnce({
      success: true as const,
      contact: { firstName: 'Jane', lastName: 'Doe', phone: '+19991112222' },
    });

    await makeSvc().onHumanHandoverIntent({
      tenantId: 't1',
      tenantDisplayName: 'Acme',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'Human please',
      memoryEntries: [
        {
          role: 'user',
          content: 'Menu?',
          sender: 'CONTACT',
          timestamp: 't1',
          messageType: 'text',
        },
      ],
      contactPhone: '+19999999999',
      contactDisplayName: null,
    });

    expect(notify.sendInternalAlert).toHaveBeenCalled();
    const arg = notify.sendInternalAlert.mock.calls[0]![0];
    expect(arg.enabled).toBe(true);
    expect(arg.teamNotificationNumber).toBe('+6512345678');
    expect(String(arg.messageBody)).toContain('Human please');
    expect(String(arg.messageBody)).toContain('Customer: Jane Doe');
    expect(String(arg.messageBody)).toContain('Phone: +19991112222');
    expect(String(arg.messageBody)).not.toMatch(/conversation\s+c1/i);
    expect(String(arg.messageBody)).not.toContain('contact ct1');
    expect(String(arg.messageBody)).toMatch(/Summary:\s*\nThe customer asked to speak with a human/i);
    expect(String(arg.messageBody)).toMatch(/\b(team|human)\b/i);
  });

  it('when AI summary fails, uses readable fallback and still sends alert', async () => {
    conversations.isInHandover.mockResolvedValueOnce(false);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: true,
      teamNotificationNumber: '+6512345678',
      optionalMessagePrefix: null,
    });
    notify.sendInternalAlert.mockResolvedValueOnce('sent');
    generation.generateDraft.mockRejectedValueOnce(new Error('no provider'));

    await makeSvc().onHumanHandoverIntent({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'agent',
      memoryEntries: [
        {
          role: 'user',
          content: 'Show me the menu',
          sender: 'CONTACT',
          timestamp: 't1',
          messageType: 'text',
        },
      ],
      contactPhone: '+15550001111',
      contactDisplayName: 'Pat',
    });

    const arg = notify.sendInternalAlert.mock.calls[0]![0];
    expect(String(arg.messageBody)).toMatch(/Summary:\s*\n.*human assistance/i);
    expect(String(arg.messageBody)).not.toMatch(/Show me the menu · agent/i);
  });

  it('when enabled but no team number, does not call notify', async () => {
    conversations.isInHandover.mockResolvedValueOnce(false);
    escalationSettings.getSettings.mockResolvedValueOnce({
      enabled: true,
      teamNotificationNumber: null,
      optionalMessagePrefix: null,
    });

    await makeSvc().onHumanHandoverIntent({
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

    await makeSvc().onHumanHandoverIntent({
      tenantId: 't1',
      conversationId: 'c1',
      contactId: 'ct1',
      latestInboundMessage: 'human',
      memoryEntries: [],
      contactPhone: null,
      contactDisplayName: null,
    });

    expect(conversations.pauseForHandover).not.toHaveBeenCalled();
    expect(followUpEngine.cancelPendingJobsForHumanEscalation).not.toHaveBeenCalled();
    expect(tagContact).not.toHaveBeenCalled();
  });
});
