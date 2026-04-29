import {
  parseBookingMode,
  parseCoreRequiredFieldsJson,
  parseMatchMode,
  parseConfidenceThreshold,
} from './tenant-automation-validation';

describe('tenant-automation-validation', () => {
  it('parses core required fields and rejects unknown keys', () => {
    expect(parseCoreRequiredFieldsJson(['name', 'phone'])).toEqual(['name', 'phone']);
    expect(() => parseCoreRequiredFieldsJson(['name', 'nope'])).toThrow();
  });

  it('parses booking mode', () => {
    expect(parseBookingMode('CHECK_AVAILABILITY')).toBe('CHECK_AVAILABILITY');
    expect(() => parseBookingMode('INVALID')).toThrow();
  });

  it('accepts lowercase tag match / confidence enums', () => {
    expect(parseMatchMode('ai')).toBe('AI');
    expect(parseConfidenceThreshold('normal')).toBe('NORMAL');
  });
});