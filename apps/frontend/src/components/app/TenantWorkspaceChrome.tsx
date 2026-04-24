'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getTenantById } from '@/lib/api';
import type { CSSProperties } from 'react';

const wrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
  marginBottom: '0.15rem',
};

const productKicker: CSSProperties = {
  fontSize: '0.65rem',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: '#94a3b8',
  fontWeight: 800,
};

const productTitle: CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 800,
  color: '#0f172a',
  letterSpacing: '-0.02em',
  lineHeight: 1.2,
};

const subline: CSSProperties = {
  fontSize: '0.8rem',
  color: '#64748b',
  margin: '0.2rem 0 0.85rem',
  lineHeight: 1.45,
  maxWidth: '52rem',
};

const tabRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0',
  borderBottom: '1px solid #e2e8f0',
  marginBottom: '1.25rem',
  background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
  borderRadius: '8px 8px 0 0',
  padding: '0.15rem 0.15rem 0 0.15rem',
};

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: '0.5rem 0.85rem',
    borderRadius: '6px 6px 0 0',
    textDecoration: 'none',
    fontSize: '0.82rem',
    fontWeight: active ? 700 : 500,
    color: active ? '#0f172a' : '#64748b',
    background: active ? '#fff' : 'transparent',
    border: '1px solid',
    borderColor: active ? '#e2e8f0' : 'transparent',
    borderBottom: active ? '1px solid #fff' : '1px solid transparent',
    marginBottom: active ? '-1px' : 0,
  };
}

function isAdvancedPath(path: string, tenantBase: string): boolean {
  return (
    path === `${tenantBase}/advanced` ||
    path.startsWith(`${tenantBase}/ghl-status`) ||
    path.startsWith(`${tenantBase}/diagnostics`) ||
    path.startsWith(`${tenantBase}/conversations`)
  );
}

const advSubWrap: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.35rem',
  marginBottom: '1.1rem',
  padding: '0.45rem 0.5rem',
  background: '#f1f5f9',
  borderRadius: '8px',
  border: '1px solid #e2e8f0',
};

function advSubStyle(active: boolean): CSSProperties {
  return {
    padding: '0.4rem 0.65rem',
    borderRadius: '6px',
    textDecoration: 'none',
    fontSize: '0.8rem',
    fontWeight: active ? 700 : 500,
    color: active ? '#0f172a' : '#64748b',
    background: active ? '#fff' : 'transparent',
    border: active ? '1px solid #cbd5e1' : '1px solid transparent',
  };
}

export function TenantWorkspaceChrome({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const { token } = useAuth();
  const base = `/app/tenant/${tenantId}`;
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await getTenantById(token, tenantId);
        if (!cancelled) setTenantName(t?.name ?? null);
      } catch {
        if (!cancelled) setTenantName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId]);

  const tabs = [
    { href: `${base}/settings`, match: (p: string) => p === `${base}/settings`, label: 'Settings' },
    { href: `${base}/knowledge`, match: (p: string) => p === `${base}/knowledge`, label: 'Knowledge Base' },
    {
      href: `${base}/goals`,
      match: (p: string) => p === `${base}/goals` || p === `${base}/bot` || p === `${base}/prompt`,
      label: 'Your bot',
    },
    { href: `${base}/usage`, match: (p: string) => p === `${base}/usage`, label: 'Usage' },
    { href: `${base}/team`, match: (p: string) => p === `${base}/team`, label: 'Team' },
    { href: `${base}/advanced`, match: (p: string) => isAdvancedPath(p, base), label: 'Advanced' },
  ];

  return (
    <div>
      <div style={wrap}>
        <div style={productKicker}>Subaccount</div>
        <div style={{ ...productTitle, margin: 0 }} role="presentation">
          {tenantName ?? '—'}
        </div>
        <p style={subline}>Bot workspace</p>
      </div>
      <nav style={tabRow} aria-label="Subaccount">
        {tabs.map(t => {
          const active = t.match(pathname);
          return (
            <Link key={t.href} href={t.href} style={tabStyle(active)} aria-current={active ? 'page' : undefined}>
              {t.label}
            </Link>
          );
        })}
      </nav>

      {isAdvancedPath(pathname, base) ? (
        <nav style={advSubWrap} aria-label="Advanced tools">
          <Link
            href={`${base}/advanced`}
            style={advSubStyle(pathname === `${base}/advanced` || pathname === `${base}/advanced/`)}
            aria-current={pathname === `${base}/advanced` || pathname === `${base}/advanced/` ? 'page' : undefined}
          >
            Overview
          </Link>
          <Link
            href={`${base}/ghl-status`}
            style={advSubStyle(pathname.startsWith(`${base}/ghl-status`))}
            aria-current={pathname.startsWith(`${base}/ghl-status`) ? 'page' : undefined}
          >
            GHL connection
          </Link>
          <Link
            href={`${base}/conversations`}
            style={advSubStyle(pathname.startsWith(`${base}/conversations`))}
            aria-current={pathname.startsWith(`${base}/conversations`) ? 'page' : undefined}
          >
            Activity
          </Link>
          <Link
            href={`${base}/diagnostics`}
            style={advSubStyle(pathname.startsWith(`${base}/diagnostics`))}
            aria-current={pathname.startsWith(`${base}/diagnostics`) ? 'page' : undefined}
          >
            Diagnostics
          </Link>
        </nav>
      ) : null}

      {children}
    </div>
  );
}
