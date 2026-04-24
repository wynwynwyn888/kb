'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { Suspense, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { WorkspaceSwitcher } from '@/components/app/WorkspaceSwitcher';
import { AgencyRecentActivity } from '@/components/app/AgencyRecentActivity';

const navStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const linkStyle = (active: boolean): CSSProperties => ({
  padding: '0.5rem 0.75rem',
  borderRadius: '6px',
  textDecoration: 'none',
  color: active ? '#fff' : '#1a1a1a',
  backgroundColor: active ? '#0070f3' : 'transparent',
  fontWeight: active ? 600 : 400,
});

const asideStyle: CSSProperties = {
  width: '260px',
  minHeight: '100vh',
  borderRight: '1px solid #e5e5e5',
  padding: '1rem',
  backgroundColor: '#fafafa',
  position: 'relative' as const,
  overflow: 'visible' as const,
  zIndex: 2,
};

const mainBase: CSSProperties = {
  flex: 1,
  padding: '1.5rem 2rem',
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, token, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user || !token) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>Loading your account…</p>
      </div>
    );
  }

  const isAgencyPath = pathname.startsWith('/app/agency');
  const isTenantPath = /^\/app\/tenant\/[^/]+/.test(pathname);
  const hasAgencyMembership = Boolean(user.agencyRole);
  const showAgencyNav = isAgencyPath && hasAgencyMembership;
  const mainStyle: CSSProperties = {
    ...mainBase,
    maxWidth: isTenantPath ? 'min(1280px, 100%)' : 'min(1100px, 100%)',
  };
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={asideStyle}>
        <div style={{ marginBottom: '0.65rem' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '-0.02em', color: '#0f172a' }}>AISBP</div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.35 }}>Control panel</div>
        </div>

        <Suspense fallback={<div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.75rem' }}>Workspace…</div>}>
          <WorkspaceSwitcher />
        </Suspense>

        <p
          style={{
            fontSize: '0.76rem',
            color: '#94a3b8',
            marginBottom: '0.75rem',
            lineHeight: 1.4,
            wordBreak: 'break-all',
          }}
        >
          {user.email}
        </p>

        {showAgencyNav && (
          <nav style={navStyle}>
            <Link href="/app/agency" style={linkStyle(pathname === '/app/agency')}>
              Dashboard
            </Link>
            <Link href="/app/agency/tenants" style={linkStyle(pathname.startsWith('/app/agency/tenants'))}>
              Subaccounts
            </Link>
            <Link
              href="/app/agency/settings/ghl"
              style={linkStyle(pathname === '/app/agency/settings/ghl')}
            >
              Integrations
            </Link>
            <Link href="/app/agency/settings/ai" style={linkStyle(pathname === '/app/agency/settings/ai')}>
              AI &amp; models
            </Link>
            <Link
              href="/app/agency/settings/quotas"
              style={linkStyle(pathname === '/app/agency/settings/quotas')}
            >
              Quotas
            </Link>
            <Link
              href="/app/agency/settings/policies"
              style={linkStyle(pathname === '/app/agency/settings/policies')}
            >
              Master Prompt
            </Link>
            <Link href="/app/agency/team" style={linkStyle(pathname === '/app/agency/team')}>
              Agency team
            </Link>
          </nav>
        )}

        {showAgencyNav ? <AgencyRecentActivity /> : null}

        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #e5e5e5' }}>
          <button
            type="button"
            onClick={() => logout().then(() => router.replace('/login'))}
            style={{
              background: 'none',
              border: '1px solid #ccc',
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main style={mainStyle}>{children}</main>
    </div>
  );
}
