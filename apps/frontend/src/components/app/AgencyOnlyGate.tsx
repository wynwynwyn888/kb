'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingBlock } from '@/components/app/mvp-ui';

/**
 * Safely prevents internal/admin-only root routes from being seen by normal client users.
 * If we can't prove agency access, we redirect to `/app`.
 */
export function AgencyOnlyGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const isAgencyStaff = Boolean(user?.agencyRole);

  useEffect(() => {
    if (loading) return;
    if (!isAgencyStaff) router.replace('/app');
  }, [loading, isAgencyStaff, router]);

  if (loading) return <LoadingBlock message="Checking access…" />;
  if (!isAgencyStaff) return <LoadingBlock message="Opening workspace…" />;
  return <>{children}</>;
}

