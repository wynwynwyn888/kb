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

/** Subscribe to `<html class="dark">` and theme storage (cross-tab) for logo / chrome that cannot use CSS alone. */
export function subscribeHtmlDarkClass(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  const el = document.documentElement;
  const run = () => onStoreChange();
  const mo = new MutationObserver(run);
  mo.observe(el, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('storage', run);
  return () => {
    mo.disconnect();
    window.removeEventListener('storage', run);
  };
}

export function getHtmlHasDarkClass(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}
