'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/app/mvp-ui';
import { TenantActionIntentsSection } from '@/components/app/tenant-workspace/TenantActionIntentsSection';

export default function TenantLogPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader title="Log" eyebrow="Workspace" />
      <p
        style={{
          fontSize: '0.88rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 1.15rem',
          lineHeight: 1.55,
          maxWidth: '42rem',
        }}
      >
        Operational audit trail for this workspace. For connection tests and routing probes, use{' '}
        <Link href={`/app/tenant/${tenantId}/diagnostics`} style={{ color: 'var(--aisbp-tenant-nav-active-text, #0f62fe)', fontWeight: 600 }}>
          Diagnostics
        </Link>
        .
      </p>
      <TenantActionIntentsSection tenantId={tenantId} />
    </div>
  );
}
