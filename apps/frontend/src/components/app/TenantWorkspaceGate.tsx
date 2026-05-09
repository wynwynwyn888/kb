'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '@/components/app/mvp-ui';
import { isAgencyOnlyAdvancedRoute, tenantBasePath } from '@/lib/tenant-workspace-nav';

/**
 * Ensures tenant-only users cannot open another tenant's URL. Agency users may open any tenant path (API still enforces data).
 */
export function TenantWorkspaceGate({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname() ?? '';
  const router = useRouter();

  const safeTenantId = typeof tenantId === 'string' && tenantId.trim().length > 0 ? tenantId.trim() : '';

  const isAgencyStaff = Boolean(user?.agencyRole);
  const tenantAdvancedBlocked =
    Boolean(safeTenantId) && !isAgencyStaff && isAgencyOnlyAdvancedRoute(pathname, safeTenantId);

  useEffect(() => {
    if (loading || !tenantAdvancedBlocked || !safeTenantId) return;
    router.replace(`${tenantBasePath(safeTenantId)}/assistant`);
  }, [loading, tenantAdvancedBlocked, router, safeTenantId]);

  if (!loading && !safeTenantId) {
    return (
      <div>
        <PageHeader title="Workspace URL" eyebrow="Access" />
        <ErrorBanner message="This workspace URL is incomplete. Use a valid workspace link." />
      </div>
    );
  }

  if (loading) {
    return <LoadingBlock message="Checking access…" />;
  }

  const isCorrectTenant = user?.tenantId != null && user.tenantId === safeTenantId;

  if (!isAgencyStaff && !isCorrectTenant) {
    return (
      <div>
        <PageHeader title="Workspace access" eyebrow="Access" />
        <ErrorBanner message="You can’t open this workspace. It doesn’t match your assignment." />
        <EmptyState
          title="Access restricted"
          detail="Use a link that includes your assigned workspace, or open a workspace from the agency list."
        />
        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          {user?.tenantId ? (
            <Link href={`/app/tenant/${user.tenantId}/assistant`} style={{ color: '#0070f3', fontWeight: 600 }}>
              Open your workspace →
            </Link>
          ) : user?.agencyRole ? (
            <Link href="/app/agency/tenants" style={{ color: '#0070f3', fontWeight: 600 }}>
              Workspaces →
            </Link>
          ) : (
            <Link href="/app" style={{ color: '#0070f3', fontWeight: 600 }}>
              Workspace entry →
            </Link>
          )}
        </p>
      </div>
    );
  }

  if (tenantAdvancedBlocked) {
    return <LoadingBlock message="Opening workspace…" />;
  }

  return <>{children}</>;
}

