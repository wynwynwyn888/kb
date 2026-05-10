import { describe, expect, it } from '@jest/globals';
import {
  formatResetDateForMessage,
  renderWarningMessage,
  sanitizeThresholdsArray,
  selectCrossedThreshold,
} from './credit-warnings.copy';
import { DEFAULT_LOW_CREDIT_WARNING_THRESHOLDS } from './credit-warnings.constants';

describe('selectCrossedThreshold', () => {
  it('returns null when nothing was crossed', () => {
    expect(
      selectCrossedThreshold({ balanceBefore: 5000, balanceAfter: 4900, enabledThresholds: [...DEFAULT_LOW_CREDIT_WARNING_THRESHOLDS] }),
    ).toBeNull();
  });

  it('returns the most urgent (lowest) crossed threshold when multiple are crossed', () => {
    expect(
      selectCrossedThreshold({ balanceBefore: 2500, balanceAfter: 900, enabledThresholds: [2000, 1000, 500, 200] }),
    ).toBe(1000);
    expect(
      selectCrossedThreshold({ balanceBefore: 2500, balanceAfter: 150, enabledThresholds: [2000, 1000, 500, 200] }),
    ).toBe(200);
  });

  it('uses strict-above before / at-or-below after rule (boundary debit triggers)', () => {
    expect(selectCrossedThreshold({ balanceBefore: 1001, balanceAfter: 1000, enabledThresholds: [1000] })).toBe(1000);
    expect(selectCrossedThreshold({ balanceBefore: 1000, balanceAfter: 999, enabledThresholds: [1000] })).toBeNull();
  });

  it('ignores disabled thresholds', () => {
    expect(selectCrossedThreshold({ balanceBefore: 2500, balanceAfter: 900, enabledThresholds: [2000] })).toBe(2000);
  });
});

describe('sanitizeThresholdsArray', () => {
  it('keeps only allow-listed thresholds and dedupes / sorts descending', () => {
    expect(sanitizeThresholdsArray([200, 1000, 500, 1000, 99])).toEqual([1000, 500, 200]);
  });
  it('returns empty array for non-array input', () => {
    expect(sanitizeThresholdsArray(null)).toEqual([]);
    expect(sanitizeThresholdsArray('1000,500')).toEqual([]);
  });
});

describe('renderWarningMessage', () => {
  it('substitutes known vars and falls back for missing client name', () => {
    const out = renderWarningMessage('Hi {{clientName}}, balance {{remainingCredits}} (threshold {{threshold}}).', {
      remainingCredits: 950,
      threshold: 1000,
      clientName: '',
      workspaceName: 'Acme',
      agencyName: 'Aisbp',
      resetDate: '10 May 2027',
    });
    expect(out).toBe('Hi there, balance 950 (threshold 1,000).');
  });

  it('keeps unknown placeholders intact (does not crash)', () => {
    const out = renderWarningMessage('{{unknownVar}} stays', {
      remainingCredits: 0,
      threshold: 200,
    });
    expect(out).toBe('{{unknownVar}} stays');
  });
});

describe('formatResetDateForMessage', () => {
  it('formats a valid ISO timestamp', () => {
    expect(formatResetDateForMessage('2027-05-10T00:00:00Z')).toMatch(/2027/);
  });
  it('returns null for missing / invalid input', () => {
    expect(formatResetDateForMessage(null)).toBeNull();
    expect(formatResetDateForMessage('not-a-date')).toBeNull();
  });
});
