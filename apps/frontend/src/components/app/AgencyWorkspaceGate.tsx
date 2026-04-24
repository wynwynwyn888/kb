'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '@/components/app/mvp-ui';

/**
 * `/app/agency/*` requires a row in `agency_users` (`agencyRole` on session from GET /auth/me).
 * Tenant-only users are redirected to their subaccount bot hub instead of seeing agency APIs fail.
 */
export function AgencyWorkspaceGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    if (!user.agencyRole && user.tenantId) {
      router.replace(`/app/tenant/${user.tenantId}/bot`);
    }
  }, [loading, user, router]);

  if (loading) {
    return <LoadingBlock message="Checking access…" />;
  }

  if (!user?.agencyRole) {
    if (user?.tenantId) {
      return <LoadingBlock message="Opening your subaccount…" />;
    }
    return (
      <div>
        <PageHeader title="Agency workspace" eyebrow="Access" />
        <ErrorBanner message="This area is for agency staff. Your account does not have agency membership." />
        <EmptyState
          title="No agency access"
          detail="Use your subaccount workspace, or contact your administrator if you need agency tools."
        />
        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          <Link href="/app" style={{ color: '#0070f3', fontWeight: 600 }}>
            Workspace entry →
          </Link>
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
