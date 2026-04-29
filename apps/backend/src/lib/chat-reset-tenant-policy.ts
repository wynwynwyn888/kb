/**
 * Tenant + env rules for inbound `/new`-style chat reset commands.
 */

export function parseEnvBoolean(raw: string | undefined): boolean | undefined {
  if (raw == null || !String(raw).trim()) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return undefined;
}

export type ChatResetAllowDeniedReason =
  | 'tenant_disabled'
  | 'env_disabled'
  | 'implicit_production_deny'
  | 'whitelist_blocked';

/** Full allow/deny breakdown for logging and inbound reset gate (no whitelist — contact gate separately). */
export function evaluateAllowChatResetCommands(params: {
  nodeEnv: string;
  envAllow?: string;
  tenantSettings?: Record<string, unknown> | null;
}): {
  allowed: boolean;
  deniedReason?: Exclude<ChatResetAllowDeniedReason, 'whitelist_blocked'>;
  tenantSettingValue: unknown;
} {
  const ts = params.tenantSettings?.['allowChatResetCommands'];
  if (ts === false) {
    return { allowed: false, deniedReason: 'tenant_disabled', tenantSettingValue: false };
  }
  if (ts === true) {
    return { allowed: true, tenantSettingValue: true };
  }
  const envParsed = parseEnvBoolean(params.envAllow);
  if (envParsed === false) {
    return {
      allowed: false,
      deniedReason: 'env_disabled',
      tenantSettingValue: ts,
    };
  }
  if (envParsed === true) {
    return { allowed: true, tenantSettingValue: ts };
  }
  const defaultAllow = params.nodeEnv !== 'production';
  if (!defaultAllow) {
    return {
      allowed: false,
      deniedReason: 'implicit_production_deny',
      tenantSettingValue: ts,
    };
  }
  return { allowed: true, tenantSettingValue: ts };
}

export function resolveAllowChatResetCommands(params: {
  nodeEnv: string;
  envAllow?: string;
  tenantSettings?: Record<string, unknown> | null;
}): boolean {
  return evaluateAllowChatResetCommands(params).allowed;
}

export function buildChatResetContactWhitelist(params: {
  envContacts?: string;
  tenantSettings?: Record<string, unknown> | null;
}): string[] {
  const fromTenant = params.tenantSettings?.['chatResetAllowedContacts'];
  const arr: string[] = [];
  if (Array.isArray(fromTenant)) {
    for (const x of fromTenant) {
      if (typeof x === 'string' && x.trim()) arr.push(x.trim().toLowerCase());
    }
  } else if (typeof fromTenant === 'string' && fromTenant.trim()) {
    arr.push(...fromTenant.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  }
  if (params.envContacts?.trim()) {
    arr.push(...params.envContacts.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  }
  return [...new Set(arr)];
}

export function isContactAllowedForChatReset(contactId: string | null | undefined, whitelist: string[]): boolean {
  if (whitelist.length === 0) return true;
  const c = (contactId ?? '').trim().toLowerCase();
  if (!c) return false;
  if (whitelist.includes(c)) return true;
  const digits = c.replace(/\D/g, '');
  if (digits.length >= 8) {
    for (const w of whitelist) {
      const wd = w.replace(/\D/g, '');
      if (wd && (digits === wd || digits.endsWith(wd) || wd.endsWith(digits))) return true;
    }
  }
  return false;
}
