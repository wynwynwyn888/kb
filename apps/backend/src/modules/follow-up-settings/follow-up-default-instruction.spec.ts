import { FollowUpSettingsService } from './follow-up-settings.service';

const mockSupabase = { from: jest.fn() };
jest.mock('../../lib/supabase', () => ({ getSupabaseService: () => mockSupabase }));

describe('follow-up empty AI instruction default', () => {
  it('accepts an enabled AI step with an empty instruction and persists the documented default', async () => {
    const service = new FollowUpSettingsService();
    jest.spyOn(service, 'getFollowUpSettings')
      .mockResolvedValueOnce({
        enabled: false, maxFollowUps: 3, stopOnCustomerReply: true,
        stopOnBookingCompleted: false, stopOnEscalated: true, stopOnOptOut: true,
        businessHoursOnly: false, activeHoursTimezoneMode: 'BUSINESS',
        activeHoursWindows: {}, steps: [],
      })
      .mockResolvedValueOnce({
        enabled: true, maxFollowUps: 1, stopOnCustomerReply: true,
        stopOnBookingCompleted: false, stopOnEscalated: true, stopOnOptOut: true,
        businessHoursOnly: false, activeHoursTimezoneMode: 'BUSINESS',
        activeHoursWindows: {}, steps: [],
      });
    let saved: Record<string, unknown> | undefined;
    mockSupabase.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: 'tenant-a' }, error: null }) }) }),
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          saved = payload;
          return { error: null };
        },
      }),
    });

    await service.patchFollowUpSettings('tenant-a', {
      enabled: true,
      maxFollowUps: 1,
      steps: [{
        stepNumber: 1, delayAmount: 1, delayUnit: 'hours',
        mode: 'ai_decides', aiInstruction: '', enabled: true,
      }],
    });
    const steps = saved?.['steps_json'] as Array<Record<string, unknown>>;
    expect(steps[0]?.['aiInstruction']).toBe(
      'Gentle nudge only. Do not sound salesy. Follow up based on the previous conversation context.',
    );
  });
});
