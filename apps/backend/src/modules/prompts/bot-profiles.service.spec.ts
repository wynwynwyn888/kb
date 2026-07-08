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
                        sales_playbook: 'Ask one qualifying question before booking',
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
    expect(out?.systemPrompt).toContain('Ask one qualifying question before booking');
    expect(out?.systemPrompt).toContain('Professional');
    expect(out?.systemPrompt).toContain('Knowledge access: All knowledge vaults');
    expect(out?.businessNotes).toBe('We ship fast');
    expect(out?.profileSections?.salesPlaybook).toBe('Ask one qualifying question before booking');
  });

  it('getActivePromptForOrchestration includes saved Critical Facts + Conversation Goals (WhatsApp parity)', async () => {
    const lockedMenu =
      '1) Leads going cold after the first conversation\n7) Something else';
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenant_bot_profiles') {
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return { eq: () => Promise.resolve({ count: 1, error: null }) };
            }
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: profileId,
                        tenant_id: tenantId,
                        name: 'AISBP Setter',
                        description: '',
                        persona: 'Direct setter',
                        conversation_goals: 'Route to AI Automation Session',
                        business_notes: '',
                        tone_rules: '',
                        booking_behavior_notes: '',
                        escalation_behavior_notes: '',
                        knowledge_scope_notes: '',
                        knowledge_scope_mode: 'all_workspace_knowledge',
                        knowledge_access_mode: 'all_vaults',
                        critical_facts: `First-message menu:\n${lockedMenu}`,
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
                  data: { id: 'cfg1', temperature: 0.7, model_override: null, max_tokens: 800, updated_at: 'u' },
                  error: null,
                }),
            }),
          }),
        };
      }
      return {};
    });
    const out = await svc.getActivePromptForOrchestration(tenantId);
    // Critical Facts must be present in the orchestration system prompt (the live WhatsApp source),
    // not only in the flag-gated per-section path.
    expect(out?.systemPrompt).toContain('### Critical facts');
    expect(out?.systemPrompt).toContain('Leads going cold after the first conversation');
    expect(out?.systemPrompt).toContain('Route to AI Automation Session');
    // profileSections still exposes the fields for the section-budget path + fingerprinting.
    expect(out?.profileSections?.criticalFacts).toContain('Leads going cold');
    expect(out?.profileSections?.goals).toContain('AI Automation Session');
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

  describe('criticalFacts validation', () => {
    it('rejects createBotProfile with criticalFacts > 2500 chars', async () => {
      await expect(
        svc.createBotProfile(userId, tenantId, { name: 'Test', criticalFacts: 'A'.repeat(2501) }),
      ).rejects.toThrow('criticalFacts must not exceed 2,500 characters');
    });

    it('accepts createBotProfile with criticalFacts exactly 2500 chars (passes validation)', async () => {
      // Validation fires before any DB call — 2500 chars must not throw validation error
      // The function will fail later on DB mock, but NOT on criticalFacts validation
      const promise = svc.createBotProfile(userId, tenantId, { name: 'Test', criticalFacts: 'A'.repeat(2500) });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('criticalFacts');
    });

    it('accepts createBotProfile with criticalFacts over the OLD 1500 limit but under 2500 (passes validation)', async () => {
      const promise = svc.createBotProfile(userId, tenantId, { name: 'Test', criticalFacts: 'A'.repeat(2000) });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('criticalFacts');
    });

    it('accepts createBotProfile with criticalFacts < 2500 chars (passes validation)', async () => {
      const promise = svc.createBotProfile(userId, tenantId, { name: 'Test', criticalFacts: 'OK' });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('criticalFacts');
    });

    it('accepts createBotProfile with empty/omitted criticalFacts (passes validation)', async () => {
      const promise = svc.createBotProfile(userId, tenantId, { name: 'Test' });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('criticalFacts');
    });

    it('rejects updateBotProfile with criticalFacts > 2500 chars', async () => {
      await expect(
        svc.updateBotProfile(userId, tenantId, profileId, { criticalFacts: 'A'.repeat(2501) }),
      ).rejects.toThrow('criticalFacts must not exceed 2,500 characters');
    });

    it('accepts updateBotProfile with criticalFacts exactly 2500 chars (passes validation)', async () => {
      const promise = svc.updateBotProfile(userId, tenantId, profileId, { criticalFacts: 'A'.repeat(2500) });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('criticalFacts');
    });

    it('accepts updateBotProfile with criticalFacts < 2500 chars (passes validation)', async () => {
      const promise = svc.updateBotProfile(userId, tenantId, profileId, { criticalFacts: 'OK' });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('criticalFacts');
    });

    it('accepts updateBotProfile with empty criticalFacts (passes validation)', async () => {
      const promise = svc.updateBotProfile(userId, tenantId, profileId, { criticalFacts: '' });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('criticalFacts');
    });
  });

  describe('persona / booking / escalation length validation', () => {
    it('rejects createBotProfile with persona > 3000 chars', async () => {
      await expect(
        svc.createBotProfile(userId, tenantId, { name: 'Test', persona: 'A'.repeat(3001) }),
      ).rejects.toThrow('persona must not exceed 3,000 characters');
    });

    it('accepts createBotProfile with persona over the OLD 1500 limit but under 3000 (passes validation)', async () => {
      const promise = svc.createBotProfile(userId, tenantId, { name: 'Test', persona: 'A'.repeat(2500) });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('persona');
    });

    it('rejects createBotProfile with bookingBehaviorNotes > 2000 chars', async () => {
      await expect(
        svc.createBotProfile(userId, tenantId, { name: 'Test', bookingBehaviorNotes: 'A'.repeat(2001) }),
      ).rejects.toThrow('bookingBehaviorNotes must not exceed 2,000 characters');
    });

    it('rejects createBotProfile with escalationBehaviorNotes > 2000 chars', async () => {
      await expect(
        svc.createBotProfile(userId, tenantId, { name: 'Test', escalationBehaviorNotes: 'A'.repeat(2001) }),
      ).rejects.toThrow('escalationBehaviorNotes must not exceed 2,000 characters');
    });

    it('accepts createBotProfile with booking/escalation over OLD 1000 limit but under 2000 (passes validation)', async () => {
      const promise = svc.createBotProfile(userId, tenantId, {
        name: 'Test',
        bookingBehaviorNotes: 'A'.repeat(1500),
        escalationBehaviorNotes: 'A'.repeat(1500),
      });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('must not exceed');
    });

    it('rejects updateBotProfile with persona > 3000 chars', async () => {
      await expect(
        svc.updateBotProfile(userId, tenantId, profileId, { persona: 'A'.repeat(3001) }),
      ).rejects.toThrow('persona must not exceed 3,000 characters');
    });

    it('does not length-validate omitted fields on update (preserves existing data)', async () => {
      const promise = svc.updateBotProfile(userId, tenantId, profileId, { name: 'Renamed' });
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.not.toThrow('must not exceed');
    });
  });
});
