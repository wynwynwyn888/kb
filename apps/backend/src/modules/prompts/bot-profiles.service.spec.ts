import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { BotProfilesService } from './bot-profiles.service';

const mockFrom = jest.fn();

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: (table: string) => mockFrom(table),
  }),
}));

describe('BotProfilesService', () => {
  const userId = 'user-1';
  const tenantId = 'tenant-1';
  const profileId = 'prof-1';

  let svc: BotProfilesService;

  beforeEach(() => {
    mockFrom.mockReset();
    const auth = {
      isTenantAdmin: jest.fn().mockResolvedValue(true),
      isAgencyAdmin: jest.fn().mockResolvedValue(false),
    };
    svc = new BotProfilesService(auth as never);
  });

  it('getActivePromptForOrchestration uses active profile fields in system prompt', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return {
                eq: () => Promise.resolve({ count: 1, error: null }),
              };
            }
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: profileId,
                        tenant_id: tenantId,
                        name: 'Sales',
                        description: '',
                        persona: 'Friendly expert',
                        conversation_goals: 'Convert leads',
                        business_notes: 'We ship fast',
                        tone_rules: 'Professional',
                        booking_behavior_notes: '',
                        escalation_behavior_notes: '',
                        knowledge_scope_notes: '',
                        knowledge_scope_mode: 'all_workspace_knowledge',
                        is_active: true,
                        created_at: 't',
                        updated_at: 't',
                      },
                      error: null,
                    }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'tenant_prompt_configs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'cfg1',
                    temperature: 0.7,
                    model_override: null,
                    max_tokens: 800,
                    updated_at: 'u',
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      return {};
    });
    const out = await svc.getActivePromptForOrchestration(tenantId);
    expect(out?.systemPrompt).toContain('Friendly expert');
    expect(out?.systemPrompt).toContain('Professional');
    expect(out?.systemPrompt).toContain('Knowledge scope: All workspace knowledge');
  });

  it('cannot delete the active profile', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: profileId, is_active: true },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    await expect(svc.deleteBotProfile(userId, tenantId, profileId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cannot delete the only profile', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return {
                eq: () => Promise.resolve({ count: 1, error: null }),
              };
            }
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: profileId, is_active: false },
                      error: null,
                    }),
                }),
              }),
            };
          },
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      return {};
    });
    await expect(svc.deleteBotProfile(userId, tenantId, profileId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
