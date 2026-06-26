export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '--';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return phone.replace(/\d/g, '*');
  const countryCode = digits.length > 8 ? digits.slice(0, 2) : digits.slice(0, 1);
  const last4 = digits.slice(-4);
  return `+${countryCode}****${last4}`;
}

export function formatDisplayLabel(businessName: string, clientKey: string): string {
  return `${businessName} · ${clientKey}`;
}

export function formatShortId(id: string | null | undefined): string {
  if (!id) return '--';
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function formatGhlLabel(contactId: string, conversationId: string): string {
  return `GHL ${formatShortId(contactId)} · ${formatShortId(conversationId)}`;
}

export function formatTenantLabel(businessName: string, shortTenantId: string): string {
  return `${businessName} · ${formatShortId(shortTenantId)}`;
}
