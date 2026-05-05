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
                        knowledge_access_mode: 'all_vaults',
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
    expect(out?.systemPrompt).toContain('Knowledge access: All knowledge vaults');
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

  it('getKbDocumentAllowlistForActiveProfile returns all when access mode is all_vaults', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return { eq: () => Promise.resolve({ count: 1, error: null }) };
            }
            if (String(cols).includes('knowledge_access_mode')) {
              return {
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: profileId, knowledge_access_mode: 'all_vaults' },
                        error: null,
                      }),
                  }),
                }),
              };
            }
            return {};
          },
        };
      }
      return {};
    });
    const out = await svc.getKbDocumentAllowlistForActiveProfile(tenantId);
    expect(out).toEqual({
      kind: 'all',
      kbVaultAccessMode: 'all_vaults',
      noActiveProfile: false,
      selectedVaultCount: 0,
      allowedDocumentCount: null,
    });
  });

  it('getKbDocumentAllowlistForActiveProfile returns none when selected_vaults but no vault links', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return { eq: () => Promise.resolve({ count: 1, error: null }) };
            }
            if (String(cols).includes('knowledge_access_mode')) {
              return {
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: profileId, knowledge_access_mode: 'selected_vaults' },
                        error: null,
                      }),
                  }),
                }),
              };
            }
            return {};
          },
        };
      }
      if (table === 'tenant_bot_profile_knowledge_vaults') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      return {};
    });
    const out = await svc.getKbDocumentAllowlistForActiveProfile(tenantId);
    expect(out).toEqual({
      kind: 'none',
      kbVaultAccessMode: 'selected_vaults',
      reason: 'profileKnowledgeVaultsEmpty',
      selectedVaultCount: 0,
      allowedDocumentCount: 0,
    });
  });

  it('getKbDocumentAllowlistForActiveProfile returns allowlist for selected vault READY docs', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return { eq: () => Promise.resolve({ count: 1, error: null }) };
            }
            if (String(cols).includes('knowledge_access_mode')) {
              return {
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: profileId, knowledge_access_mode: 'selected_vaults' },
                        error: null,
                      }),
                  }),
                }),
              };
            }
            return {};
          },
        };
      }
      if (table === 'tenant_bot_profile_knowledge_vaults') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ vault_id: 'vault-1' }], error: null }),
          }),
        };
      }
      if (table === 'knowledge_documents') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => Promise.resolve({ data: [{ id: 'doc-a' }, { id: 'doc-b' }], error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const out = await svc.getKbDocumentAllowlistForActiveProfile(tenantId);
    expect(out).toEqual({
      kind: 'allowlist',
      kbVaultAccessMode: 'selected_vaults',
      documentIds: ['doc-a', 'doc-b'],
      selectedVaultCount: 1,
      allowedDocumentCount: 2,
    });
  });

  it('getKbDocumentAllowlistForActiveProfile returns none when selected vaults have no READY docs', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return { eq: () => Promise.resolve({ count: 1, error: null }) };
            }
            if (String(cols).includes('knowledge_access_mode')) {
              return {
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: profileId, knowledge_access_mode: 'selected_vaults' },
                        error: null,
                      }),
                  }),
                }),
              };
            }
            return {};
          },
        };
      }
      if (table === 'tenant_bot_profile_knowledge_vaults') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ vault_id: 'vault-1' }], error: null }),
          }),
        };
      }
      if (table === 'knowledge_documents') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const out = await svc.getKbDocumentAllowlistForActiveProfile(tenantId);
    expect(out).toEqual({
      kind: 'none',
      kbVaultAccessMode: 'selected_vaults',
      reason: 'selectedVaultsNoDocuments',
      selectedVaultCount: 1,
      allowedDocumentCount: 0,
    });
  });

  it('getKbDocumentAllowlistForActiveProfile returns all with noActiveProfile when no active profile', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              // Non-zero count skips ensureMigratedForTenant legacy migration (no tenant_prompt_configs mock needed)
              return { eq: () => Promise.resolve({ count: 1, error: null }) };
            }
            if (String(cols).includes('knowledge_access_mode')) {
              return {
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              };
            }
            return {};
          },
        };
      }
      return {};
    });
    const out = await svc.getKbDocumentAllowlistForActiveProfile(tenantId);
    expect(out).toEqual({
      kind: 'all',
      kbVaultAccessMode: 'all_vaults',
      noActiveProfile: true,
      selectedVaultCount: 0,
      allowedDocumentCount: null,
    });
  });
});
