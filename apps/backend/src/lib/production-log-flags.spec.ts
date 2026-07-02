import {
  ghlWebhookLogBodyKeysEnabled,
  ghlWebhookShapeDiagnosticsEnabled,
  outboundWhitespaceDebugEnabled,
  promptFootprintDebugEnabled,
  isPromptSectionBudgetsEnabledForTenant,
} from './production-log-flags';

describe('production-log-flags', () => {
  const store = { ...process.env };

  afterEach(() => {
    process.env = { ...store };
  });

  it('defaults GHL shape diagnostics off in production when env unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GHL_WEBHOOK_SHAPE_DIAGNOSTICS;
    expect(ghlWebhookShapeDiagnosticsEnabled()).toBe(false);
  });

  it('enables GHL shape diagnostics when env true even in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_WEBHOOK_SHAPE_DIAGNOSTICS = 'true';
    expect(ghlWebhookShapeDiagnosticsEnabled()).toBe(true);
  });

  it('defaults GHL body keys log off in production when env unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GHL_WEBHOOK_LOG_BODY_KEYS;
    expect(ghlWebhookLogBodyKeysEnabled()).toBe(false);
  });

  it('defaults outbound whitespace debug off in production when env unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OUTBOUND_WHITESPACE_DEBUG;
    expect(outboundWhitespaceDebugEnabled()).toBe(false);
  });

  it('promptFootprintDebug stays on unless explicitly false', () => {
    delete process.env.PROMPT_FOOTPRINT_DEBUG;
    expect(promptFootprintDebugEnabled()).toBe(true);
    process.env.PROMPT_FOOTPRINT_DEBUG = 'false';
    expect(promptFootprintDebugEnabled()).toBe(false);
  });

  describe('isPromptSectionBudgetsEnabledForTenant', () => {
    it('PROMPT_SECTION_BUDGETS unset = false', () => {
      delete process.env.PROMPT_SECTION_BUDGETS;
      expect(isPromptSectionBudgetsEnabledForTenant('t1')).toBe(false);
    });

    it('PROMPT_SECTION_BUDGETS=false = false', () => {
      process.env.PROMPT_SECTION_BUDGETS = 'false';
      expect(isPromptSectionBudgetsEnabledForTenant('t1')).toBe(false);
    });

    it('PROMPT_SECTION_BUDGETS=true + no allowlist = all enabled', () => {
      process.env.PROMPT_SECTION_BUDGETS = 'true';
      delete process.env.PROMPT_SECTION_BUDGETS_TENANTS;
      expect(isPromptSectionBudgetsEnabledForTenant('any-tenant')).toBe(true);
    });

    it('PROMPT_SECTION_BUDGETS=true + empty allowlist = all enabled', () => {
      process.env.PROMPT_SECTION_BUDGETS = 'true';
      process.env.PROMPT_SECTION_BUDGETS_TENANTS = '';
      expect(isPromptSectionBudgetsEnabledForTenant('any-tenant')).toBe(true);
    });

    it('tenant in allowlist = enabled', () => {
      process.env.PROMPT_SECTION_BUDGETS = 'true';
      process.env.PROMPT_SECTION_BUDGETS_TENANTS = 't1,t2,t3';
      expect(isPromptSectionBudgetsEnabledForTenant('t1')).toBe(true);
      expect(isPromptSectionBudgetsEnabledForTenant('t2')).toBe(true);
    });

    it('tenant not in allowlist = disabled', () => {
      process.env.PROMPT_SECTION_BUDGETS = 'true';
      process.env.PROMPT_SECTION_BUDGETS_TENANTS = 't1,t2';
      expect(isPromptSectionBudgetsEnabledForTenant('t3')).toBe(false);
    });

    it('global off overrides allowlist', () => {
      delete process.env.PROMPT_SECTION_BUDGETS;
      process.env.PROMPT_SECTION_BUDGETS_TENANTS = 't1';
      expect(isPromptSectionBudgetsEnabledForTenant('t1')).toBe(false);
    });
  });
});
