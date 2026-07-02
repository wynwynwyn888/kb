// Orchestration prompt assembly flag-path tests
import { jest as jestGlobal } from '@jest/globals';

// Mock process.env for flag testing
const originalEnv = { ...process.env };

afterAll(() => { process.env = originalEnv; });

// Import the build function after mocks are set up
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
    sections: { persona: 'SECTION_PERSONA', criticalFacts: 'PRICES_$50' },
    truncated: {}, totalChars: 200, approxTokens: 50,
  })),
  buildCompactedPromptBody: jestGlobal.fn(() => '### Bot Persona\nSECTION_PERSONA\n\n### Critical facts\nPRICES_$50'),
}));
jestGlobal.mock('../../lib/production-log-flags', () => ({
  promptFootprintDebugEnabled: jestGlobal.fn(() => false),
  isPromptSectionBudgetsEnabledForTenant: jestGlobal.fn((tid: string) => {
    if (process.env['PROMPT_SECTION_BUDGETS'] !== 'true') return false;
    const allowlist = (process.env['PROMPT_SECTION_BUDGETS_TENANTS'] ?? '').trim();
    if (!allowlist) return true;
    return allowlist.split(',').includes(tid);
  }),
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
    agencyPolicy: { id: 'ap1', systemPrompt: 'OLD_AGENCY' },
    ...overrides,
  };
}

// Access the private method via any cast
function build(service: ConversationOrchestrationService, input: ReturnType<typeof makeInput>) {
  return (service as any).buildSystemPromptWithRuntimeGreeting(input, 'collect_details_only');
}

describe('orchestration prompt assembly — flag path', () => {
  let service: ConversationOrchestrationService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    delete process.env['PROMPT_SECTION_BUDGETS'];
    delete process.env['PROMPT_SECTION_BUDGETS_TENANTS'];
    service = new (ConversationOrchestrationService as any)();
  });

  it('flag OFF uses old single-blob path', () => {
    const result = build(service, makeInput());
    expect(result).toContain('OLD_TENANT_BODY');
    expect(result).toContain('OLD_AGENCY_BODY');
    expect(result).not.toContain('Critical facts');
    expect(result).not.toContain('PRICES_$50');
  });

  it('flag ON + tenant allowed + profileSections uses per-section path', () => {
    process.env['PROMPT_SECTION_BUDGETS'] = 'true';
    const result = build(service, makeInput());
    expect(result).toContain('Critical facts');
    expect(result).toContain('PRICES_$50');
    expect(result).not.toContain('OLD_TENANT_BODY');
  });

  it('flag ON + tenant not allowlisted uses old path', () => {
    process.env['PROMPT_SECTION_BUDGETS'] = 'true';
    process.env['PROMPT_SECTION_BUDGETS_TENANTS'] = 't2,t3';
    const result = build(service, makeInput({ tenantId: 't1' }));
    expect(result).toContain('OLD_TENANT_BODY');
    expect(result).not.toContain('Critical facts');
  });

  it('flag ON + no profileSections uses old path', () => {
    process.env['PROMPT_SECTION_BUDGETS'] = 'true';
    const result = build(service, makeInput({
      promptConfig: { id: 'pc1', systemPrompt: 'OLD', temperature: 0.7, maxTokens: null, isActive: true },
    }));
    expect(result).toContain('OLD_TENANT_BODY');
    expect(result).not.toContain('Critical facts');
  });

  it('Critical Facts appears only in new path', () => {
    process.env['PROMPT_SECTION_BUDGETS'] = 'true';
    const result = build(service, makeInput());
    expect(result).toContain('Critical facts');
    // Flag OFF: should not appear
    delete process.env['PROMPT_SECTION_BUDGETS'];
    const result2 = build(service, makeInput());
    expect(result2).not.toContain('Critical facts');
  });

  it('WhatsApp output contract remains after sections', () => {
    process.env['PROMPT_SECTION_BUDGETS'] = 'true';
    const result = build(service, makeInput());
    expect(result).toContain('WHATSAPP_CONTRACT');
  });

  it('brand identity remains after sections', () => {
    process.env['PROMPT_SECTION_BUDGETS'] = 'true';
    const result = build(service, makeInput());
    expect(result).toContain('BRAND_IDENTITY');
  });

  it('governor appendix remains after sections', () => {
    process.env['PROMPT_SECTION_BUDGETS'] = 'true';
    const result = build(service, makeInput());
    expect(result).toContain('GOVERNOR_APPENDIX');
  });

  it('old compactPersonaPolicyForGeneration preserved when flag OFF', () => {
    const result = build(service, makeInput());
    expect(result).toContain('OLD_TENANT_BODY');
  });
});
