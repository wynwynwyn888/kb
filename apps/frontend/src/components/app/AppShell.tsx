'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { WorkspaceSwitcher } from '@/components/app/WorkspaceSwitcher';
import { BrandLogo } from '@/components/app/BrandLogo';
import { TenantNavIcon } from '@/components/app/TenantNavIcon';
import { buildTenantSidebarNav, type TenantNavNode } from '@/lib/tenant-workspace-nav';
import { appFloatingSecondaryButtonStyle } from '@/components/app/mvp-ui';
import { ThemeToggle } from '@/components/app/ThemeToggle';
import { useMediaQuery } from '@/hooks/use-media-query';

const MOBILE_NAV_BP = '(max-width: 768px)';

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

const tenantNavChildLinkStyle = (active: boolean): CSSProperties => ({
  display: 'block',
  padding: '0.38rem 0.65rem 0.38rem 2.85rem',
  borderRadius: '8px',
  textDecoration: 'none',
  fontSize: '0.78rem',
  fontWeight: active ? 700 : 600,
  color: active ? 'var(--aisbp-tenant-nav-active-text, #0f62fe)' : 'var(--aisbp-nav-text, #64748b)',
  background: active ? 'var(--aisbp-tenant-nav-active-bg, rgba(15, 98, 254, 0.08))' : 'transparent',
  border: '1px solid',
  borderColor: active ? 'rgba(15, 98, 254, 0.18)' : 'transparent',
});

const tenantNavGroupButtonStyle = (active: boolean): CSSProperties => ({
  ...tenantNavLinkStyle(active),
  width: '100%',
  cursor: 'pointer',
});

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      style={{
        marginLeft: 'auto',
        opacity: 0.7,
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 120ms ease',
      }}
    >
      <path d="M7 5l6 5-6 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

  const isAgencyPath = pathname.startsWith('/app/agency');
  const tenantMatch = pathname.match(/^\/app\/tenant\/([^/]+)/);
  const tenantIdFromPathRaw = tenantMatch?.[1];
  const tenantIdFromPath =
    typeof tenantIdFromPathRaw === 'string' && tenantIdFromPathRaw.trim().length > 0
      ? tenantIdFromPathRaw.trim()
      : null;
  const isTenantPath = Boolean(tenantIdFromPath);
  const tenantNavNodes: TenantNavNode[] = tenantIdFromPath
    ? buildTenantSidebarNav(tenantIdFromPath, {
        showAdvanced: Boolean(user?.agencyRole),
        showLogs: Boolean(user?.agencyRole),
      })
    : [];

  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useMediaQuery(MOBILE_NAV_BP);
  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

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

  const hasAgencyMembership = Boolean(user.agencyRole);
  const showAgencyNav = isAgencyPath && hasAgencyMembership;
  const sidebarWidthPx = isTenantPath ? SIDEBAR_TENANT_PX : SIDEBAR_AGENCY_PX;

  const mainStyle: CSSProperties = {
    ...mainBase,
    marginLeft: isMobile ? 0 : sidebarWidthPx,
    maxWidth: isTenantPath ? 'min(1200px, 100%)' : 'min(1120px, 100%)',
    marginTop: 0,
    paddingTop: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
  };

  const asideStyle: CSSProperties = {
    ...(isTenantPath ? asideTenant : asideAgency),
    ...(isMobile
      ? {
          transform: mobileNavOpen ? 'translateX(0)' : 'translateX(-105%)',
          transition: 'transform 180ms ease',
          boxShadow: mobileNavOpen ? '8px 0 32px rgba(15, 23, 42, 0.18)' : 'none',
        }
      : {}),
  };

  const mainScrollStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    padding: isMobile ? '1rem 1rem 2rem' : '1.75rem 2.25rem 2.5rem',
    overflowY: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as const,
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--aisbp-shell-bg, #f8fafc)' }}>
      <a
        href="#app-main-content"
        className="aisbp-skip-link"
        style={{
          position: 'absolute',
          left: -9999,
          top: 'auto',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
        onFocus={e => {
          e.currentTarget.style.left = '12px';
          e.currentTarget.style.top = '12px';
          e.currentTarget.style.width = 'auto';
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.padding = '0.5rem 0.75rem';
          e.currentTarget.style.background = '#fff';
          e.currentTarget.style.zIndex = '10001';
        }}
        onBlur={e => {
          e.currentTarget.style.left = '-9999px';
        }}
      >
        Skip to main content
      </a>
      {isMobile && mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 39,
            border: 'none',
            background: 'rgba(15, 23, 42, 0.45)',
            cursor: 'pointer',
          }}
        />
      ) : null}
      <aside style={asideStyle} aria-hidden={isMobile && !mobileNavOpen ? true : undefined}>
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
                {tenantNavNodes.map(node => {
                  if (node.kind === 'leaf') {
                    const active = node.match(pathname);
                    return (
                      <Link
                        key={node.href}
                        href={node.href}
                        style={tenantNavLinkStyle(active)}
                        aria-current={active ? 'page' : undefined}
                      >
                        <span style={{ display: 'flex', color: 'inherit', flexShrink: 0 }}>
                          <TenantNavIcon icon={node.icon} />
                        </span>
                        <span>{node.label}</span>
                      </Link>
                    );
                  }
                  const groupActive = node.match(pathname);
                  const isOpen = groupOpen[node.label] ?? groupActive;
                  return (
                    <div key={node.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setGroupOpen(s => ({ ...s, [node.label]: true }));
                          if (pathname !== node.overviewHref) {
                            router.push(node.overviewHref);
                          }
                        }}
                        style={tenantNavGroupButtonStyle(groupActive)}
                        aria-expanded={isOpen}
                        aria-controls={`tenant-nav-group-${node.label}`}
                      >
                        <span style={{ display: 'flex', color: 'inherit', flexShrink: 0 }}>
                          <TenantNavIcon icon={node.icon} />
                        </span>
                        <span>{node.label}</span>
                        <Chevron open={isOpen} />
                      </button>
                      {isOpen ? (
                        <div
                          id={`tenant-nav-group-${node.label}`}
                          style={{ display: 'flex', flexDirection: 'column', gap: '0.08rem' }}
                          role="group"
                          aria-label={`${node.label} sections`}
                        >
                          {node.children.map(child => {
                            const cActive = child.match(pathname);
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                style={tenantNavChildLinkStyle(cActive)}
                                aria-current={cActive ? 'page' : undefined}
                              >
                                {child.label}
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
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
                <nav style={navStyle} aria-label="Agency navigation">
                  <Link href="/app/agency" style={linkStyle(pathname === '/app/agency')} aria-current={pathname === '/app/agency' ? 'page' : undefined}>
                    Dashboard
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
                    CRM Connection
                  </Link>
                  <Link href="/app/agency/log" style={linkStyle(pathname.startsWith('/app/agency/log'))}>
                    Activity log
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
                  <Link href="/app/agency/ops" style={linkStyle(pathname === '/app/agency/ops')}>
                    Operations
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
      <main id="app-main-content" style={mainStyle}>
        <header style={appHeaderBar}>
          {isMobile ? (
            <button
              type="button"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(v => !v)}
              style={{
                ...appFloatingSecondaryButtonStyle,
                marginRight: 'auto',
                padding: '0.4rem 0.65rem',
              }}
            >
              Menu
            </button>
          ) : null}
          <ThemeToggle />
        </header>
        <div style={mainScrollStyle}>{children}</div>
      </main>
    </div>
  );
}
