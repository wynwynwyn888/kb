import { describe, expect, it } from 'vitest';
import { resolveInitialTheme } from './theme-preference';

describe('theme-preference', () => {
  it('uses stored light/dark when set', () => {
    expect(resolveInitialTheme('dark', false)).toBe('dark');
    expect(resolveInitialTheme('light', true)).toBe('light');
  });

  it('falls back to system preference when stored is unknown', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark');
    expect(resolveInitialTheme('', false)).toBe('light');
    expect(resolveInitialTheme('system', false)).toBe('light');
  });
});
