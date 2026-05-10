'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState, PageHeader } from '@/components/app/mvp-ui';
import { TenantActionIntentsSection } from '@/components/app/tenant-workspace/TenantActionIntentsSection';

export default function TenantLogPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { user } = useAuth();
  const isAgencyStaff = Boolean(user?.agencyRole);

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader title="Activity log" eyebrow="Workspace" />
      {isAgencyStaff ? (
        <>
          <p
            style={{
              fontSize: '0.88rem',
              color: 'var(--aisbp-muted, #64748b)',
              margin: '0 0 1.15rem',
              lineHeight: 1.55,
              maxWidth: '42rem',
            }}
          >
            Operational audit trail for this workspace.
          </p>
          <TenantActionIntentsSection tenantId={tenantId} />
        </>
      ) : (
        <>
          <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 1rem', lineHeight: 1.55, maxWidth: '42rem' }}>
            Activity log is available to support users only.
          </p>
          <EmptyState
            title="Admin-only area"
            detail="If you need help reviewing recent activity, contact your workspace admin."
          />
          <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
            <Link href={`/app/tenant/${tenantId}/usage`} style={{ color: '#0070f3', fontWeight: 600 }}>
              Open Credit & Usage →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
