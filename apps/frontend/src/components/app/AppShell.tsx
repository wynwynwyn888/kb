'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { Suspense, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { WorkspaceSwitcher } from '@/components/app/WorkspaceSwitcher';
import { BrandLogo } from '@/components/app/BrandLogo';
import { TenantNavIcon } from '@/components/app/TenantNavIcon';
import { buildTenantNavItems } from '@/lib/tenant-workspace-nav';
import { appFloatingSecondaryButtonStyle } from '@/components/app/mvp-ui';
import { ThemeToggle } from '@/components/app/ThemeToggle';

const SIDEBAR_AGENCY_PX = 260;
const SIDEBAR_TENANT_PX = 276;

const navStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const linkStyle = (active: boolean): CSSProperties => ({
  padding: '0.55rem 0.75rem',
  borderRadius: '10px',
  textDecoration: 'none',
  color: active ? 'var(--aisbp-nav-active-text, #0f172a)' : 'var(--aisbp-nav-text, #475569)',
  backgroundColor: active ? 'var(--aisbp-nav-active-bg, #fff)' : 'transparent',
  fontWeight: active ? 750 : 600,
  fontSize: '0.9rem',
  border: active ? '1px solid var(--aisbp-border, #e2e8f0)' : '1px solid transparent',
  boxShadow: active ? '0 4px 14px rgba(15, 23, 42, 0.07)' : 'none',
});

function tenantNavLinkStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.65rem',
    padding: '0.55rem 0.7rem',
    borderRadius: '12px',
    textDecoration: 'none',
    fontSize: '0.875rem',
    fontWeight: active ? 700 : 600,
    color: active ? 'var(--aisbp-tenant-nav-active-text, #0f62fe)' : 'var(--aisbp-nav-text, #475569)',
    background: active ? 'var(--aisbp-tenant-nav-active-bg, rgba(15, 98, 254, 0.1))' : 'transparent',
    border: '1px solid',
    borderColor: active ? 'rgba(15, 98, 254, 0.22)' : 'transparent',
    boxShadow: active ? '0 4px 14px rgba(15, 98, 254, 0.12)' : 'none',
  };
}

const asideFixedBase: CSSProperties = {
  position: 'fixed' as const,
  top: 0,
  left: 0,
  height: '100vh',
  maxHeight: '100dvh',
  boxSizing: 'border-box' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  overflow: 'hidden',
  zIndex: 40,
};

const asideAgency: CSSProperties = {
  ...asideFixedBase,
  width: SIDEBAR_AGENCY_PX,
  borderRight: '1px solid var(--aisbp-border, #e5e5e5)',
  padding: '1rem',
  backgroundColor: 'var(--aisbp-surface-muted, #f8fafc)',
};

const asideTenant: CSSProperties = {
  ...asideFixedBase,
  width: SIDEBAR_TENANT_PX,
  borderRight: '1px solid var(--aisbp-border, #e2e8f0)',
  padding: '1rem 0.85rem',
  backgroundColor: 'var(--aisbp-sidebar-tenant-bg, rgba(255, 255, 255, 0.98))',
  boxShadow: '4px 0 28px rgba(15, 23, 42, 0.05)',
};

const mainBase: CSSProperties = {
  flex: 1,
  background: 'var(--aisbp-main-bg, #f8fafc)',
  minHeight: '100vh',
  boxSizing: 'border-box' as const,
};

const appHeaderBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 12,
  padding: '0.65rem 2.25rem',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
  background: 'var(--aisbp-main-bg, #f8fafc)',
  minHeight: 48,
  boxSizing: 'border-box' as const,
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
      <div style={{ padding: '2rem', background: 'var(--aisbp-bg, #f8fafc)', minHeight: '100vh' }}>
        <p style={{ color: 'var(--aisbp-text, #0f172a)', margin: 0 }}>Loading your account…</p>
      </div>
    );
  }

  const isAgencyPath = pathname.startsWith('/app/agency');
  const tenantMatch = pathname.match(/^\/app\/tenant\/([^/]+)/);
  const tenantIdFromPath = tenantMatch?.[1] ?? null;
  const isTenantPath = Boolean(tenantIdFromPath);
  const hasAgencyMembership = Boolean(user.agencyRole);
  const showAgencyNav = isAgencyPath && hasAgencyMembership;
  const sidebarWidthPx = isTenantPath ? SIDEBAR_TENANT_PX : SIDEBAR_AGENCY_PX;

  const mainStyle: CSSProperties = {
    ...mainBase,
    marginLeft: sidebarWidthPx,
    maxWidth: isTenantPath ? 'min(1200px, 100%)' : 'min(1120px, 100%)',
    marginTop: 0,
    paddingTop: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
  };

  const mainScrollStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    padding: '1.75rem 2.25rem 2.5rem',
    overflowY: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as const,
  };

  const tenantNavItems = tenantIdFromPath ? buildTenantNavItems(tenantIdFromPath) : [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--aisbp-shell-bg, #f8fafc)' }}>
      <aside style={isTenantPath ? asideTenant : asideAgency}>
        <div style={{ marginBottom: '0.85rem' }}>
          <BrandLogo height={34} maxWidth={200} />
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
          {isTenantPath ? (
            <>
              <Suspense fallback={<div style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #94a3b8)', marginBottom: '0.75rem' }}>Loading…</div>}>
                <WorkspaceSwitcher />
              </Suspense>
              <nav style={{ ...navStyle, marginTop: '1rem', flex: 1 }} aria-label="Client workspace">
                {tenantNavItems.map(t => {
                  const active = t.match(pathname);
                  return (
                    <Link key={t.href} href={t.href} style={tenantNavLinkStyle(active)} aria-current={active ? 'page' : undefined}>
                      <span style={{ display: 'flex', color: 'inherit', flexShrink: 0 }}>
                        <TenantNavIcon icon={t.icon} />
                      </span>
                      <span>{t.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </>
          ) : (
            <>
              <Suspense fallback={<div style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #94a3b8)', marginBottom: '0.75rem' }}>Workspace…</div>}>
                <WorkspaceSwitcher />
              </Suspense>
              <p
                style={{
                  fontSize: '0.76rem',
                  color: 'var(--aisbp-muted, #94a3b8)',
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
                    Control Center
                  </Link>
                  <Link
                    href="/app/agency/tenants"
                    style={linkStyle(pathname.startsWith('/app/agency/tenants'))}
                    onClick={e => {
                      if (e.defaultPrevented) return;
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      router.push('/app/agency/tenants');
                    }}
                  >
                    Client Workspaces
                  </Link>
                  <Link href="/app/agency/settings/ghl" style={linkStyle(pathname === '/app/agency/settings/ghl')}>
                    CRM
                  </Link>
                  <Link href="/app/agency/log" style={linkStyle(pathname.startsWith('/app/agency/log'))}>
                    Log
                  </Link>
                  <Link href="/app/agency/settings/ai" style={linkStyle(pathname === '/app/agency/settings/ai')}>
                    AI Provider
                  </Link>
                  <Link href="/app/agency/settings/quotas" style={linkStyle(pathname === '/app/agency/settings/quotas')}>
                    Credits
                  </Link>
                  <Link href="/app/agency/settings/policies" style={linkStyle(pathname === '/app/agency/settings/policies')}>
                    Global Prompt
                  </Link>
                  <Link href="/app/agency/team" style={linkStyle(pathname === '/app/agency/team')}>
                    Team
                  </Link>
                </nav>
              )}

            </>
          )}
        </div>

        <div
          style={{
            marginTop: 'auto',
            paddingTop: '1rem',
            borderTop: '1px solid var(--aisbp-border, #e2e8f0)',
            flexShrink: 0,
          }}
        >
          {isTenantPath ? (
            <p
              style={{
                fontSize: '0.72rem',
                color: 'var(--aisbp-muted, #94a3b8)',
                marginBottom: '0.65rem',
                lineHeight: 1.4,
                wordBreak: 'break-all',
              }}
            >
              {user.email}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => logout().then(() => router.replace('/login'))}
            style={{
              ...appFloatingSecondaryButtonStyle,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main style={mainStyle}>
        <header style={appHeaderBar}>
          <ThemeToggle />
        </header>
        <div style={mainScrollStyle}>{children}</div>
      </main>
    </div>
  );
}
