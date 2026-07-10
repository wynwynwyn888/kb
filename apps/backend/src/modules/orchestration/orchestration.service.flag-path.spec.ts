// Orchestration prompt assembly tests — section-budget default path + legacy fallback.
import { jest as jestGlobal } from '@jest/globals';

const originalEnv = { ...process.env };
afterAll(() => { process.env = originalEnv; });

jestGlobal.mock('../../lib/supabase', () => ({ getSupabaseService: () => ({}) }));
jestGlobal.mock('../../lib/brand-assistant-identity', () => ({
  buildBrandAssistantIdentitySystemContent: jestGlobal.fn(() => 'BRAND_IDENTITY'),
}));
jestGlobal.mock('../../lib/whatsapp-output-contract', () => ({
  WHATSAPP_OUTPUT_CONTRACT_BLOCK: 'WHATSAPP_CONTRACT',
}));
jestGlobal.mock('../../lib/business-time', () => ({
  getBusinessLocalNow: jestGlobal.fn(() => ({ timeZone: 'UTC', dayPeriod: 'evening', greetingLabel: 'Good evening' })),
}));
jestGlobal.mock('../../lib/outbound-safety-governor', () => ({
  buildGovernorCapabilityAppendix: jestGlobal.fn(() => 'GOVERNOR_APPENDIX'),
}));
jestGlobal.mock('../../lib/compact-runtime-system-prompt', () => ({
  compactPersonaPolicyForGeneration: jestGlobal.fn(() => ({
    tenantBody: 'OLD_TENANT_BODY', agencyBody: 'OLD_AGENCY_BODY',
    tenantTruncated: false, agencyTruncated: false,
  })),
  estimateApproxTokens: jestGlobal.fn(() => 100),
  compactProfileSections: jestGlobal.fn(() => ({
    sections: { criticalFacts: 'PRICES_$50', persona: 'SECTION_PERSONA' },
    truncated: {}, totalChars: 200, approxTokens: 50,
  })),
  buildCompactedPromptBody: jestGlobal.fn(() => '### Critical facts\nPRICES_$50\n\n### Bot Persona\nSECTION_PERSONA'),
  budgetGlobalPolicy: jestGlobal.fn((p: string | null | undefined) => ({
    text: (p ?? '').trim(), truncated: false,
  })),
}));
jestGlobal.mock('../../lib/production-log-flags', () => ({
  promptFootprintDebugEnabled: jestGlobal.fn(() => false),
}));
jestGlobal.mock('../../lib/prompt-compact-truncation-warn', () => ({
  promptCompactTruncationWarnKey: jestGlobal.fn(() => 'key'),
  shouldEmitPromptCompactTruncationWarn: jestGlobal.fn(() => false),
}));
jestGlobal.mock('../../lib/format-postgrest-error', () => ({ formatPostgrestError: jestGlobal.fn() }));

import { ConversationOrchestrationService } from '../../modules/orchestration/orchestration.service';

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    conversationId: 'c1',
    incomingMessage: { ghlLocationId: '', ghlConversationId: '', ghlContactId: '', messageContent: '', messageType: 'text', timestamp: '', externalEventId: '', eventType: '', dedupeKey: '' },
    tenant: { id: 't1', name: 'Test', botEnabled: true, botMode: 'autopilot' as const, handoverPaused: false, ghlLocationId: 'loc1', timeZone: 'UTC' },
    promptConfig: {
      id: 'pc1', systemPrompt: 'OLD_SYSTEM_PROMPT', temperature: 0.7, maxTokens: null, isActive: true,
      profileSections: { criticalFacts: 'Prices: $50-200', persona: 'Friendly' },
    },
    agencyPolicy: { id: 'ap1', systemPrompt: 'GLOBAL_POLICY_TEXT' },
    ...overrides,
  };
}

function build(service: ConversationOrchestrationService, input: ReturnType<typeof makeInput>) {
  return (service as any).buildSystemPromptWithRuntimeGreeting(input, 'collect_details_only');
}

describe('orchestration prompt assembly — section-budget default path', () => {
  let service: ConversationOrchestrationService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    delete process.env['PROMPT_SECTION_BUDGETS'];
    delete process.env['PROMPT_SECTION_BUDGETS_TENANTS'];
    service = new (ConversationOrchestrationService as any)();
  });

  it('uses per-section budgets by default when profileSections present (no feature flag needed)', () => {
    const result = build(service, makeInput());
    expect(result).toContain('### Critical facts');
    expect(result).toContain('PRICES_$50');
    expect(result).not.toContain('OLD_TENANT_BODY');
  });

  it('injects Global Prompt separately and does NOT drop it (section path)', () => {
    const result = build(service, makeInput());
    expect(result).toContain('Global policy');
    expect(result).toContain('GLOBAL_POLICY_TEXT');
    // Global appears before the tenant sections.
    expect(result.indexOf('GLOBAL_POLICY_TEXT')).toBeLessThan(result.indexOf('### Critical facts'));
  });

  it('still assembles cleanly when there is no Global Prompt', () => {
    const result = build(service, makeInput({ agencyPolicy: null }));
    expect(result).toContain('### Critical facts');
    expect(result).not.toContain('Global policy');
  });

  it('falls back to legacy blob path only when profileSections is absent', () => {
    const result = build(service, makeInput({
      promptConfig: { id: 'pc1', systemPrompt: 'OLD', temperature: 0.7, maxTokens: null, isActive: true },
    }));
    expect(result).toContain('OLD_TENANT_BODY');
    expect(result).toContain('OLD_AGENCY_BODY');
    expect(result).not.toContain('### Critical facts');
  });

  it('WhatsApp output contract remains after sections', () => {
    expect(build(service, makeInput())).toContain('WHATSAPP_CONTRACT');
  });

  it('brand identity is not duplicated in the primary prompt (injected once via buildMessages instead)', () => {
    expect(build(service, makeInput())).not.toContain('BRAND_IDENTITY');
  });

  it('governor appendix remains after sections', () => {
    expect(build(service, makeInput())).toContain('GOVERNOR_APPENDIX');
  });

  it('section-budget path is independent of PROMPT_SECTION_BUDGETS env flag', () => {
    process.env['PROMPT_SECTION_BUDGETS'] = 'false';
    const result = build(service, makeInput());
    expect(result).toContain('### Critical facts');
    expect(result).toContain('GLOBAL_POLICY_TEXT');
  });
});
