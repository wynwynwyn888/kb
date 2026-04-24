'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '@/components/app/mvp-ui';

/**
 * Ensures tenant-only users cannot open another tenant's URL. Agency users may open any tenant path (API still enforces data).
 */
export function TenantWorkspaceGate({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingBlock message="Checking access…" />;
  }

  const isAgencyStaff = Boolean(user?.agencyRole);
  const isCorrectTenant = user?.tenantId != null && user.tenantId === tenantId;

  if (!isAgencyStaff && !isCorrectTenant) {
    return (
      <div>
        <PageHeader title="Subaccount access" eyebrow="Access" />
        <ErrorBanner message="You can’t open this subaccount. It doesn’t match your assignment." />
        <EmptyState
          title="Access restricted"
          detail="Use a link that includes your assigned subaccount id, or open a subaccount from the agency list."
        />
        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          {user?.tenantId ? (
            <Link href={`/app/tenant/${user.tenantId}/goals`} style={{ color: '#0070f3', fontWeight: 600 }}>
              Open your subaccount workspace →
            </Link>
          ) : user?.agencyRole ? (
            <Link href="/app/agency/tenants" style={{ color: '#0070f3', fontWeight: 600 }}>
              Subaccounts →
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

  return <>{children}</>;
}
