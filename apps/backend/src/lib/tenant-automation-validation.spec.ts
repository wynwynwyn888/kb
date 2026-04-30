import {
  parseBookingMode,
  parseCoreFieldsJson,
  parseMatchMode,
  parseConfidenceThreshold,
} from './tenant-automation-validation';

describe('tenant-automation-validation', () => {
  it('parses core fields object', () => {
    const o = parseCoreFieldsJson({
      name: { enabled: true, required: true },
      phone: { enabled: false, required: false },
    });
    expect(o.name).toEqual({ enabled: true, required: true });
    expect(o.phone).toEqual({ enabled: false, required: false });
    expect(() => parseCoreFieldsJson({ nope: { enabled: true, required: false } })).toThrow();
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
