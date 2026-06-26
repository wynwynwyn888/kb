'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { SafetyBanner } from '@/components/SafetyBanner';

const SIDEBAR_WIDTH = 260;

const navItems = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/clients', label: 'Clients', icon: '👥' },
  { href: '/review-queue', label: 'Review Queue', icon: '🔍' },
  { href: '/audit', label: 'Audit Log', icon: '📝' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

const asideStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: SIDEBAR_WIDTH,
  height: '100vh',
  maxHeight: '100dvh',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 40,
  borderRight: '1px solid var(--aisbp-border, #e2e8f0)',
  padding: '1rem',
  backgroundColor: 'var(--aisbp-surface-muted, #f8fafc)',
};

const navStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

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

const mainStyle: CSSProperties = {
  marginLeft: SIDEBAR_WIDTH,
  minHeight: '100vh',
  boxSizing: 'border-box',
  background: 'var(--aisbp-main-bg, #f8fafc)',
  display: 'flex',
  flexDirection: 'column',
};

const headerBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.65rem 2.25rem',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
  background: 'var(--aisbp-main-bg, #f8fafc)',
  minHeight: 48,
  boxSizing: 'border-box',
};

const contentStyle: CSSProperties = {
  flex: 1,
  padding: '1.75rem 2.25rem 2.5rem',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
};

export function OnboardChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--aisbp-shell-bg, #f8fafc)' }}>
      <aside style={asideStyle}>
        <div style={{ marginBottom: '0.85rem' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 750, color: 'var(--aisbp-text, #0f172a)' }}>
            AISBP-Onboard
          </span>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <nav style={navStyle} aria-label="Onboard navigation">
            {navItems.map(item => {
              const active = item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={navLinkStyle(active)}
                  aria-current={active ? 'page' : undefined}
                >
                  <span style={{ fontSize: '1rem' }}>{item.icon}</span>
                  <span>{item.label}</span>
                  {item.label === 'Review Queue' && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        background: '#FEF3C7',
                        color: '#D97706',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '0.1rem 0.4rem',
                        borderRadius: 999,
                      }}
                    >
                      1
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div
          style={{
            marginTop: 'auto',
            paddingTop: '1rem',
            borderTop: '1px solid var(--aisbp-border, #e2e8f0)',
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem' }}>
            Auth required — integration pending
          </p>
          <button
            type="button"
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: 10,
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              background: 'var(--aisbp-surface, #fff)',
              color: 'var(--aisbp-text, #0f172a)',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main id="app-main-content" style={mainStyle}>
        <header style={headerBarStyle}>
          <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', fontWeight: 600 }}>
            AISBP-Onboard v0.1 — Foundation Shell
          </span>
        </header>
        <div style={contentStyle}>
          <SafetyBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
