/**
 * Safe rules for updating GHL contact name from AISBP-collected name (MVP).
 */

export function existingContactDisplayName(contact: Record<string, unknown> | undefined): string | undefined {
  if (!contact) return undefined;
  const first = typeof contact['firstName'] === 'string' ? contact['firstName'].trim() : '';
  const last = typeof contact['lastName'] === 'string' ? contact['lastName'].trim() : '';
  const combined = [first, last].filter(Boolean).join(' ').trim();
  if (combined) return combined;
  const n =
    (typeof contact['contactName'] === 'string' && contact['contactName'].trim()) ||
    (typeof contact['name'] === 'string' && contact['name'].trim()) ||
    '';
  return n || undefined;
}

/** True when existing name looks "real" and should not be overwritten by collected name. */
export function shouldSkipNameEnrichment(existingDisplay: string | undefined): boolean {
  const e = existingDisplay?.trim();
  if (!e) return false;
  if (e.length <= 2) return false;
  if (/^\+?\d[\d\s\-().]{6,}$/.test(e)) return false;
  if (/^(contact|visitor|unknown|test)\b/i.test(e)) return false;
  return true;
}

export function splitNameForGhl(full: string): { firstName: string; lastName: string } {
  const p = full.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return { firstName: '', lastName: '' };
  if (p.length === 1) return { firstName: p[0]!, lastName: p[0]! };
  return { firstName: p[0]!, lastName: p.slice(1).join(' ') };
}

export function digitsOnly(s: string | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

export function maskPhoneForLog(phone: string): string {
  const d = digitsOnly(phone);
  if (d.length < 6) return '****';
  return `${d.slice(0, 2)}…${d.slice(-2)}`;
}
