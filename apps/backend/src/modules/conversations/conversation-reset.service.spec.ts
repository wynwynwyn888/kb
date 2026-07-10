import { ConversationResetService } from './conversation-reset.service';

describe('ConversationResetService', () => {
  it('builds a visible /new confirmation reply for prompt testing', () => {
    const service = new ConversationResetService(
      { get: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    const plan = service.buildConfirmationReplyPlan();

    expect(plan.planStatus).toBe('PLANNED');
    expect(plan.rationale).toBe('chat_reset_confirmation');
    expect(plan.bubbles).toEqual([
      {
        index: 0,
        text: 'Started a fresh chat for this conversation.\n\nYou can test from here.',
      },
    ]);
  });
});
