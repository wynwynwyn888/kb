/**
 * Shared display formatters for the Ops dashboard.
 * All tabs use the same formatting for tenant, contact, and conversation identifiers.
 */

/** Mask a phone number: +65****8634 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****' + phone.slice(-2);
  const prefix = phone.startsWith('+') ? phone.slice(0, 3) : '';
  const suffix = digits.slice(-4);
  return `${prefix}****${suffix}`;
}

/** Short ID: first 8 characters */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.slice(0, 8);
}

/**
 * Tenant display: Name · shortId
 * Falls back to shortId if name is missing.
 * Returns 'Unknown tenant · shortId' if id is provided but no name.
 */
export function tenantDisplay(name: string | null | undefined, id: string | null | undefined): string {
  if (!id) return '—';
  const sid = shortId(id);
  if (name && name.trim()) return `${name.trim()} · ${sid}`;
  return `Tenant ${sid}`;
}

/**
 * Contact display: name > masked phone > short contact ID
 */
export function contactDisplay(params: {
  contactName?: string | null;
  contactPhone?: string | null;
  contactId?: string | null;
}): string {
  const { contactName, contactPhone, contactId } = params;
  if (contactName?.trim()) return contactName.trim();
  const masked = maskPhone(contactPhone);
  if (masked) return masked;
  if (contactId?.trim()) return shortId(contactId);
  return '—';
}

/**
 * Conversation display: contact label · short conversation ID
 * Example: +65****8634 · b6bac998
 */
export function conversationDisplay(params: {
  contactName?: string | null;
  contactPhone?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
}): string {
  const contact = contactDisplay({ contactName: params.contactName, contactPhone: params.contactPhone, contactId: params.contactId });
  const convId = shortId(params.conversationId);
  if (contact === '—' && convId === '—') return '—';
  if (contact === '—') return `Conv ${convId}`;
  if (convId === '—') return contact;
  return `${contact} · ${convId}`;
}
