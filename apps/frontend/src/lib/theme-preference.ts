export const THEME_STORAGE_KEY = 'aisbp-theme';

export type ThemePreference = 'light' | 'dark';

export function resolveInitialTheme(stored: string | null, prefersDark: boolean): ThemePreference {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function readStoredTheme(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function applyThemeClass(theme: ThemePreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
