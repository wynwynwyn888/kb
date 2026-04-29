'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isAdvancedPath, tenantBasePath } from '@/lib/tenant-workspace-nav';
import type { CSSProperties } from 'react';

const advSubWrap: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem',
  marginBottom: '1.1rem',
  padding: '0.5rem 0.55rem',
  background: 'var(--aisbp-glass-bg, rgba(248, 250, 252, 0.95))',
  borderRadius: '12px',
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
};

function advSubStyle(active: boolean): CSSProperties {
  return {
    padding: '0.45rem 0.75rem',
    borderRadius: '10px',
    textDecoration: 'none',
    fontSize: '0.8rem',
    fontWeight: active ? 700 : 600,
    color: active ? 'var(--aisbp-text-heading, #0f172a)' : 'var(--aisbp-muted, #64748b)',
    background: active ? 'var(--aisbp-surface, #fff)' : 'transparent',
    border: active ? '1px solid var(--aisbp-border, #e2e8f0)' : '1px solid transparent',
    boxShadow: active ? '0 4px 12px rgba(15, 23, 42, 0.06)' : 'none',
  };
}

export function TenantWorkspaceChrome({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const base = tenantBasePath(tenantId);

  return (
    <div>
      {isAdvancedPath(pathname, tenantId) ? (
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
            CRM
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
