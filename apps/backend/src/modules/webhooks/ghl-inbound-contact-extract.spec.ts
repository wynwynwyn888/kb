import { describe, expect, it } from '@jest/globals';
import { extractInboundContactFields } from './ghl-inbound-contact-extract';

describe('extractInboundContactFields', () => {
  it('maps snake_case full_name and phone', () => {
    const r = extractInboundContactFields({
      full_name: 'Sam Lee',
      phone: '+6512345678',
    });
    expect(r.displayName).toBe('Sam Lee');
    expect(r.phone).toBe('+6512345678');
    expect(r.fromExtendedWebhookKeys).toBe(true);
  });

  it('prefers contactName when present with phoneNumber', () => {
    const r = extractInboundContactFields({
      contactName: 'Alex',
      phoneNumber: '+1000',
    });
    expect(r.displayName).toBe('Alex');
    expect(r.phone).toBe('+1000');
    expect(r.fromExtendedWebhookKeys).toBe(false);
  });

  it('reads phone from workflow-flat contact when data lacks it', () => {
    const r = extractInboundContactFields(
      { contactId: 'c1' },
      { contact: { phone: '+6598765432' } },
    );
    expect(r.phone).toBe('+6598765432');
  });
});
