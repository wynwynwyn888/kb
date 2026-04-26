'use client';

import { PageHeader, SectionCard } from '@/components/app/mvp-ui';

export default function TenantAdvancedHubPage() {
  return (
    <div>
      <PageHeader title="Advanced" eyebrow="Support tools" />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.55, maxWidth: '42rem' }}>
        Support and troubleshooting tools for connection checks, conversation activity, and routing diagnostics.
      </p>

      <SectionCard title="What lives here" subtitle="Use these when you need deeper troubleshooting.">
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', color: '#475569', lineHeight: 1.55 }}>
          <li>
            <strong>HighLevel connection</strong> — read-only status and connection checks for the HighLevel link (same data as the dedicated
            URL).
          </li>
          <li style={{ marginTop: '0.5rem' }}>
            <strong>Activity</strong> — conversation list and message viewer for this workspace.
          </li>
          <li style={{ marginTop: '0.5rem' }}>
            <strong>Diagnostics</strong> — handovers, intents, and AI route probes exposed by the API.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
