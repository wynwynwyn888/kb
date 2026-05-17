function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function pickPhoneFromRow(row: Record<string, unknown>): string {
  const keys = [
    'phoneNumber',
    'phone',
    'primaryPhone',
    'phone_number',
    'mobile',
    'cellPhone',
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) return t;
    }
  }
  return '';
}

/**
 * Read contact identity fields from GHL inbound webhook `data` objects.
 * Handles camelCase and snake_case keys seen in production payloads.
 */
export function extractInboundContactFields(
  data: Record<string, unknown>,
  workflowFlatRaw?: Record<string, unknown>,
): {
  displayName: string | null;
  phone: string | null;
  email: string | null;
  /** True when alternate / snake_case webhook keys contributed (for staff-alert provenance logging). */
  fromExtendedWebhookKeys: boolean;
} {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = data[k];
      if (typeof v === 'string') {
        const t = v.trim();
        if (t) return t;
      }
    }
    return '';
  };

  const firstName = pick('firstName', 'first_name');
  const lastName = pick('lastName', 'last_name');
  const composed = [firstName, lastName].filter(Boolean).join(' ').trim();

  const contactName = pick('contactName');
  const fullName = pick('fullName', 'full_name');
  const display = contactName || fullName || composed || '';

  const phoneNumber = pick('phoneNumber');
  const phoneAlt = pick('phone', 'primaryPhone');
  let phone = phoneNumber || phoneAlt;

  if (!phone && workflowFlatRaw) {
    const contact = workflowFlatRaw['contact'];
    if (isPlainObject(contact)) {
      phone = pickPhoneFromRow(contact) || phone;
    }
    const cd = workflowFlatRaw['customData'];
    if (isPlainObject(cd)) {
      phone = pickPhoneFromRow(cd) || phone;
      const nested = cd['contact'];
      if (isPlainObject(nested)) {
        phone = pickPhoneFromRow(nested) || phone;
      }
    }
  }

  const email = pick('email');

  const fromExtendedWebhookKeys = Boolean(
    pick('first_name', 'firstName') ||
      pick('last_name', 'lastName') ||
      pick('full_name', 'fullName') ||
      pick('phone', 'primaryPhone'),
  );

  return {
    displayName: display.length ? display : null,
    phone: phone.length ? phone : null,
    email: email.length ? email : null,
    fromExtendedWebhookKeys,
  };
}
