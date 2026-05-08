'use client';

import { AgencyRecentActivity } from '@/components/app/AgencyRecentActivity';
import { PageHeader, SectionCard } from '@/components/app/mvp-ui';

export default function AgencyLogPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader title="Log" eyebrow="Agency account" />
      <p
        style={{
          fontSize: '0.88rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 1.25rem',
          lineHeight: 1.55,
          maxWidth: '40rem',
        }}
      >
        Credits and workspace setup changes for your agency.
      </p>
      <SectionCard title="Recent activity" subtitle="Latest events from the audit trail (newest first).">
        <AgencyRecentActivity />
      </SectionCard>
    </div>
  );
}
