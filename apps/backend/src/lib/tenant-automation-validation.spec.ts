import {
  parseBookingMode,
  parseCoreFieldsJson,
  parseMatchMode,
  parseConfidenceThreshold,
  parseFollowUpSteps,
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

  it('parses up to 10 follow-up steps and normalizes legacy mode', () => {
    const steps = Array.from({ length: 10 }).map((_, i) => ({
      stepNumber: i + 1,
      delayAmount: 1,
      delayUnit: 'minutes',
      mode: i === 0 ? 'fixed' : 'ai',
      fixedMessage: i === 0 ? 'hello' : undefined,
      aiInstruction: i === 0 ? undefined : 'gentle',
      enabled: true,
    }));
    const out = parseFollowUpSteps(steps);
    expect(out).toHaveLength(10);
    expect(out[0]?.mode).toBe('fixed_message');
    expect(out[1]?.mode).toBe('ai_decides');
    expect(() => parseFollowUpSteps([...steps, steps[0]])).toThrow();
  });
});
