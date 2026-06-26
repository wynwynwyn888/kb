'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode, FormEvent } from 'react';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SafetyBanner } from '@/components/SafetyBanner';

const SIDEBAR_WIDTH = 260;

const navItems = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/clients', label: 'Clients', icon: '👥' },
  { href: '/review-queue', label: 'Review Queue', icon: '🔍' },
  { href: '/audit', label: 'Audit Log', icon: '📝' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

function navLinkStyle(active: boolean): CSSProperties {
  return {
    padding: '0.55rem 0.75rem',
    borderRadius: '10px',
    textDecoration: 'none',
    color: active ? 'var(--aisbp-nav-active-text, #0f172a)' : 'var(--aisbp-nav-text, #475569)',
    backgroundColor: active ? 'var(--aisbp-nav-active-bg, #fff)' : 'transparent',
    fontWeight: active ? 750 : 600,
    fontSize: '0.88rem',
    border: active ? '1px solid var(--aisbp-border, #e2e8f0)' : '1px solid transparent',
    boxShadow: active ? '0 4px 14px rgba(15, 23, 42, 0.07)' : 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  };
}

export function OnboardChrome({ children }: { children: ReactNode }) {
  const { user, loading, error, token, login, logout } = useAuth();
  const pathname = usePathname();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      await login(email, password);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', background: 'var(--aisbp-bg, #f8fafc)', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: 'var(--aisbp-text, #0f172a)', margin: 0 }}>Loading your account...</p>
      </div>
    );
  }

  if (!user || !token) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: 'var(--aisbp-bg, #f8fafc)',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <form onSubmit={handleLogin} style={{
          background: 'var(--aisbp-surface, #fff)', padding: '2rem', borderRadius: 14,
          border: '1px solid var(--aisbp-border, #e2e8f0)', width: '100%', maxWidth: 380,
        }}>
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
            AISBP-Onboard
          </h1>
          <p style={{ margin: '0 0 1.5rem', fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)' }}>
            Sign in with your AISBP account
          </p>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--aisbp-text, #0f172a)' }}>
              Email
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{
                width: '100%', padding: '0.55rem 0.75rem', borderRadius: 10,
                border: '1px solid var(--aisbp-border, #e2e8f0)', fontSize: '0.9rem',
                background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--aisbp-text, #0f172a)' }}>
              Password
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{
                width: '100%', padding: '0.55rem 0.75rem', borderRadius: 10,
                border: '1px solid var(--aisbp-border, #e2e8f0)', fontSize: '0.9rem',
                background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {loginError && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#FEE2E2', borderRadius: 8, fontSize: '0.82rem', color: '#DC2626', marginBottom: '1rem' }}>
              {loginError}
            </div>
          )}
          <button
            type="submit" disabled={loggingIn}
            style={{
              width: '100%', padding: '0.55rem 1rem', borderRadius: 10,
              border: 'none', background: '#2563EB', color: '#fff',
              fontWeight: 600, fontSize: '0.88rem', cursor: loggingIn ? 'not-allowed' : 'pointer',
              opacity: loggingIn ? 0.7 : 1,
            }}
          >
            {loggingIn ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--aisbp-shell-bg, #f8fafc)' }}>
      <aside style={{
        position: 'fixed', top: 0, left: 0, width: SIDEBAR_WIDTH, height: '100vh',
        maxHeight: '100dvh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', zIndex: 40, borderRight: '1px solid var(--aisbp-border, #e2e8f0)',
        padding: '1rem', backgroundColor: 'var(--aisbp-surface-muted, #f8fafc)',
      }}>
        <div style={{ marginBottom: '0.85rem' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 750, color: 'var(--aisbp-text, #0f172a)' }}>
            AISBP-Onboard
          </span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, overflowY: 'auto' }} aria-label="Onboard navigation">
          {navItems.map(item => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} style={navLinkStyle(active)} aria-current={active ? 'page' : undefined}>
                <span style={{ fontSize: '1rem' }}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--aisbp-border, #e2e8f0)', flexShrink: 0 }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem' }}>
            {user.email}
          </p>
          <button type="button" onClick={logout} style={{
            width: '100%', padding: '0.5rem 0.75rem', borderRadius: 10,
            border: '1px solid var(--aisbp-border, #e2e8f0)',
            background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)',
            fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
          }}>
            Sign out
          </button>
        </div>
      </aside>

      <main id="app-main-content" style={{
        marginLeft: SIDEBAR_WIDTH, minHeight: '100vh', boxSizing: 'border-box',
        background: 'var(--aisbp-main-bg, #f8fafc)', display: 'flex', flexDirection: 'column',
      }}>
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.65rem 2.25rem', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
          background: 'var(--aisbp-main-bg, #f8fafc)', minHeight: 48, boxSizing: 'border-box',
        }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', fontWeight: 600 }}>
            AISBP-Onboard v0.1 — Manual Setup UI
          </span>
        </header>
        <div style={{ flex: 1, padding: '1.75rem 2.25rem 2.5rem', overflowY: 'auto' }}>
          <SafetyBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
