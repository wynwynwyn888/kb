function isNodeProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

function envIsTrue(name: string): boolean {
  return process.env[name] === 'true';
}

function envIsFalse(name: string): boolean {
  return process.env[name] === 'false';
}

/** Default off in production; on in dev when unset. */
export function ghlWebhookShapeDiagnosticsEnabled(): boolean {
  if (envIsTrue('GHL_WEBHOOK_SHAPE_DIAGNOSTICS')) return true;
  if (envIsFalse('GHL_WEBHOOK_SHAPE_DIAGNOSTICS')) return false;
  return !isNodeProduction();
}

/** Default off in production; on in dev when unset. */
export function ghlWebhookLogBodyKeysEnabled(): boolean {
  if (envIsTrue('GHL_WEBHOOK_LOG_BODY_KEYS')) return true;
  if (envIsFalse('GHL_WEBHOOK_LOG_BODY_KEYS')) return false;
  return !isNodeProduction();
}

/** Default off in production; on in dev when unset. */
export function outboundWhitespaceDebugEnabled(): boolean {
  if (envIsTrue('OUTBOUND_WHITESPACE_DEBUG')) return true;
  if (envIsFalse('OUTBOUND_WHITESPACE_DEBUG')) return false;
  return !isNodeProduction();
}

/** When false, skip verbose runtime prompt footprint INFO logs. */
export function promptFootprintDebugEnabled(): boolean {
  return process.env['PROMPT_FOOTPRINT_DEBUG'] !== 'false';
}

/** Per-section prompt budgets enabled for a specific tenant. */
export function isPromptSectionBudgetsEnabledForTenant(tenantId: string): boolean {
  if (process.env['PROMPT_SECTION_BUDGETS'] !== 'true') return false;
  const allowlist = (process.env['PROMPT_SECTION_BUDGETS_TENANTS'] ?? '').trim();
  if (!allowlist) return true; // global on + empty allowlist = all tenants
  return allowlist.split(',').map(s => s.trim()).filter(Boolean).includes(tenantId);
}
