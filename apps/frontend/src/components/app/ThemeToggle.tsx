'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  applyThemeClass,
  readStoredTheme,
  resolveInitialTheme,
  type ThemePreference,
} from '@/lib/theme-preference';

function iconSun() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function iconMoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>('light');

  useEffect(() => {
    const stored = readStoredTheme();
    const prefersDark =
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = resolveInitialTheme(stored, prefersDark);
    applyThemeClass(resolved);
    setTheme(resolved);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => {
      const s = readStoredTheme();
      if (s === 'light' || s === 'dark') return;
      const next = resolveInitialTheme(null, mq.matches);
      applyThemeClass(next);
      setTheme(next);
    };
    mq.addEventListener('change', onMq);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY || e.newValue == null) return;
      if (e.newValue === 'light' || e.newValue === 'dark') {
        applyThemeClass(e.newValue);
        setTheme(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggle = useCallback(() => {
    const next: ThemePreference = theme === 'dark' ? 'light' : 'dark';
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore quota / private mode */
    }
    applyThemeClass(next);
    setTheme(next);
  }, [theme]);

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '0.35rem 0.55rem',
        borderRadius: 10,
        border: '1px solid var(--aisbp-border, #e2e8f0)',
        background: 'var(--aisbp-surface, #fff)',
        color: 'var(--aisbp-text-secondary, #334155)',
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontWeight: 650,
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)',
      }}
    >
      {isDark ? iconSun() : iconMoon()}
      <span style={{ letterSpacing: '0.02em' }}>{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
