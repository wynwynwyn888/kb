import { jest as jestGlobal } from '@jest/globals';
import { BotTestService } from './bot-test.service';

const mockSupabase = {
  from: jestGlobal.fn(),
};

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: jestGlobal.fn(() => mockSupabase),
}));

function chain(result: unknown) {
  const c: Record<string, jestGlobal.Mock> = {};
  c.select = jestGlobal.fn(() => c);
  c.eq = jestGlobal.fn(() => c);
  c.order = jestGlobal.fn(() => c);
  c.limit = jestGlobal.fn(() => c);
  c.single = jestGlobal.fn(async () => ({ data: result, error: null }));
  c.maybeSingle = jestGlobal.fn(async () => ({ data: result, error: null }));
  return c;
}

describe('BotTestService', () => {
  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') return chain({ id: 'tenant-1', agency_id: 'agency-1' });
      if (table === 'agency_system_policies') return chain([{ content: 'Agency policy', priority: 1, created_at: 't' }]);
      return chain(null);
    });
  });

  it('passes continuation policy context so Test AI does not restart first-message flows', async () => {
    const generation = {
      generateDraft: jestGlobal.fn(async () => ({
        content: 'Continued reply',
        generationProvider: 'OPENAI',
        generationModel: 'gpt-4o-mini',
      })),
    };
    const svc = new BotTestService(
      { checkTenantAccess: jestGlobal.fn(async () => true) } as never,
      generation as never,
      { retrieve: jestGlobal.fn(async () => ({ chunks: [] })) } as never,
      { getConfig: jestGlobal.fn(async () => ({ activeProvider: 'OPENAI', activeModel: 'gpt-4o-mini' })) } as never,
      {
        getActivePromptForOrchestration: jestGlobal.fn(async () => ({
          id: 'profile-1',
          systemPrompt: 'First message: ask name and show menu.',
          modelOverride: '',
          temperature: null,
          maxTokens: null,
          profileSections: {},
          updatedAt: '2026-01-01T00:00:00.000Z',
        })),
        getKbDocumentAllowlistForActiveProfile: jestGlobal.fn(async () => ({ kind: 'all' })),
      } as never,
    );

    await svc.runTest('tenant-1', 'profile-1', {
      message: 'hi',
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hello! What is your name?\n1) Leads going cold\n2) Staff too busy' },
      ],
    });

    const draftParams = generation.generateDraft.mock.calls[0]![0] as {
      policyContext?: {
        latestIntent?: string;
        conversationStateSummary?: string;
        priorAssistantMessageCount?: number;
      };
    };
    expect(draftParams.policyContext).toEqual(
      expect.objectContaining({
        latestIntent: 'GREETING',
        conversationStateSummary: 'preview_continuation',
        priorAssistantMessageCount: 1,
      }),
    );
  });

  it('uses the same declared prompt hierarchy and section order as live replies', async () => {
    const generation = {
      generateDraft: jestGlobal.fn(async () => ({ content: 'Reply' })),
    };
    const svc = new BotTestService(
      { checkTenantAccess: jestGlobal.fn(async () => true) } as never,
      generation as never,
      { retrieve: jestGlobal.fn(async () => ({ chunks: [] })) } as never,
      { getConfig: jestGlobal.fn(async () => ({ activeProvider: 'OPENAI', activeModel: 'gpt-4o-mini' })) } as never,
      {
        getActivePromptForOrchestration: jestGlobal.fn(async () => ({
          id: 'profile-1',
          systemPrompt: 'legacy order should not be used',
          modelOverride: '',
          temperature: 0.7,
          maxTokens: 800,
          profileSections: {
            criticalFacts: 'CRITICAL',
            salesPlaybook: 'PLAYBOOK',
            persona: 'PERSONA',
          },
          updatedAt: '2026-01-01T00:00:00.000Z',
        })),
        getKbDocumentAllowlistForActiveProfile: jestGlobal.fn(async () => ({ kind: 'all' })),
      } as never,
    );

    await svc.runTest('tenant-1', 'profile-1', { message: 'hello' });

    const prompt = (generation.generateDraft.mock.calls[0]![0] as { systemPrompt: string }).systemPrompt;
    expect(prompt).toContain('Global Prompt; Critical Facts; Sales Playbook');
    expect(prompt.indexOf('Agency policy')).toBeLessThan(prompt.indexOf('### Critical facts'));
    expect(prompt.indexOf('### Critical facts')).toBeLessThan(prompt.indexOf('### Sales playbook'));
    expect(prompt.indexOf('### Sales playbook')).toBeLessThan(prompt.indexOf('### Bot Persona'));
  });
});
