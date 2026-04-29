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

export function resolveAllowChatResetCommands(params: {
  nodeEnv: string;
  envAllow?: string;
  tenantSettings?: Record<string, unknown> | null;
}): boolean {
  const ts = params.tenantSettings?.['allowChatResetCommands'];
  if (ts === false) return false;
  if (ts === true) return true;
  const envParsed = parseEnvBoolean(params.envAllow);
  if (envParsed !== undefined) return envParsed;
  return params.nodeEnv !== 'production';
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
