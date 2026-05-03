import { describe, expect, it } from '@jest/globals';
import { OUTBOUND_PLACEHOLDER_FALLBACK, sanitizeOutboundCustomerText } from './outbound-customer-text';

describe('sanitizeOutboundCustomerText', () => {
  it('replaces [Insert …] style template leaks', () => {
    const t = sanitizeOutboundCustomerText('Visit us at [Insert exact address here] tomorrow.');
    expect(t).toBe(OUTBOUND_PLACEHOLDER_FALLBACK);
  });

  it('replaces TODO / placeholder markers', () => {
    expect(sanitizeOutboundCustomerText('Nearest: TODO add MRT')).toBe(OUTBOUND_PLACEHOLDER_FALLBACK);
    expect(sanitizeOutboundCustomerText('This is a placeholder line.')).toBe(OUTBOUND_PLACEHOLDER_FALLBACK);
  });

  it('replaces exact address here phrase', () => {
    expect(sanitizeOutboundCustomerText('We are at exact address here in district 1.')).toBe(OUTBOUND_PLACEHOLDER_FALLBACK);
  });

  it('replaces known fake-address tutorial strings', () => {
    expect(sanitizeOutboundCustomerText("We're located at 123 Hair Avenue, Singapore.")).toBe(OUTBOUND_PLACEHOLDER_FALLBACK);
    expect(sanitizeOutboundCustomerText('The nearest MRT station is Hair Station.')).toBe(OUTBOUND_PLACEHOLDER_FALLBACK);
  });

  it('passes through normal salon copy', () => {
    expect(sanitizeOutboundCustomerText('See you Tuesday at 3pm!')).toBe('See you Tuesday at 3pm!');
  });
});
