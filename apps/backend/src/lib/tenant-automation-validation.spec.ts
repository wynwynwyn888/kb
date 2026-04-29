import {
  assertAllowedRequiredFieldKeys,
  parseBookingMode,
  parseRequiredFieldsJson,
} from './tenant-automation-validation';

describe('tenant-automation-validation', () => {
  it('parses requiredFieldsJson and rejects unknown keys', () => {
    expect(parseRequiredFieldsJson(['name', 'phone'])).toEqual(['name', 'phone']);
    assertAllowedRequiredFieldKeys(['name']);
    expect(() => parseRequiredFieldsJson({})).toThrow();
    expect(() => assertAllowedRequiredFieldKeys(['name', 'nope'])).toThrow();
  });

  it('parses booking mode', () => {
    expect(parseBookingMode('CHECK_AVAILABILITY')).toBe('CHECK_AVAILABILITY');
    expect(() => parseBookingMode('INVALID')).toThrow();
  });
});
