'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Entry: route by *membership*, not by tenant parent agency.
 * - Agency workspace requires `agencyRole` (row in agency_users).
 * - Subaccount workspace uses `tenantId` (row in tenant_users).
 * - Both => explicit chooser (no silent wrong shell).
 */
export default function AppEntryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    const hasAgency = Boolean(user.agencyRole);
    const hasTenant = Boolean(user.tenantId);
    if (hasAgency && hasTenant) {
      router.replace('/app/workspace');
      return;
    }
    if (hasAgency) {
      router.replace('/app/agency');
      return;
    }
    if (hasTenant) {
      router.replace(`/app/tenant/${user.tenantId}/goals`);
      return;
    }
    router.replace('/login');
  }, [user, loading, router]);

  return (
    <div style={{ padding: '2rem' }}>
      <p>Opening your workspace…</p>
    </div>
  );
}
