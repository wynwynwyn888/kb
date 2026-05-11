import {
  ghlWebhookLogBodyKeysEnabled,
  ghlWebhookShapeDiagnosticsEnabled,
  outboundWhitespaceDebugEnabled,
  promptFootprintDebugEnabled,
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
});
