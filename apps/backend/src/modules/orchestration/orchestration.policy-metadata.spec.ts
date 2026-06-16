import { jest as jestGlobal } from '@jest/globals';
import { ConversationOrchestrationService } from './orchestration.service';
import { AISBP_POLICY_METADATA_KEY } from '../conversation-policy/conversation-policy-state';

describe('ConversationOrchestrationService — persistConversationPolicyMetadata', () => {
  it('merges policy into latest DB metadata without dropping staged human escalation alert', async () => {
    const conversationId = 'conv-1';
    const pendingAlert = {
      latestInboundMessage: 'I need a human',
      summary: 'Customer wants help',
      customerName: 'Alex',
      phoneForAlert: '+6587272277',
      contactId: 'ct-1',
    };
    let storedMetadata: Record<string, unknown> = {
      humanEscalationPendingInternalAlert: pendingAlert,
    };

    const supabase = {
      from: jestGlobal.fn((table: string) => {
        if (table !== 'conversations') throw new Error(`unexpected table ${table}`);
        return {
          select: jestGlobal.fn(() => ({
            eq: jestGlobal.fn(() => ({
              maybeSingle: jestGlobal.fn(async () => ({
                data: { metadata: storedMetadata },
                error: null,
              })),
            })),
          })),
          update: jestGlobal.fn((row: { metadata: Record<string, unknown> }) => ({
            eq: jestGlobal.fn(() => {
              storedMetadata = row.metadata;
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }),
    };

    const svc = new ConversationOrchestrationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    (svc as unknown as { supabase: typeof supabase }).supabase = supabase;

    const policyState = {
      v: 1 as const,
      activeTopic: 'handover' as const,
      awaiting: null,
      options: undefined,
      optionsUpdatedAt: null,
      optionsSource: null,
      optionsDerivedFromChunkIds: null,
      expiresAt: null,
      updatedAt: new Date().toISOString(),
    };

    await (
      svc as unknown as {
        persistConversationPolicyMetadata: (
          id: string,
          state: typeof policyState,
        ) => Promise<void>;
      }
    ).persistConversationPolicyMetadata(conversationId, policyState);

    expect(storedMetadata['humanEscalationPendingInternalAlert']).toEqual(pendingAlert);
    expect(storedMetadata[AISBP_POLICY_METADATA_KEY]).toEqual(policyState);
  });
});
