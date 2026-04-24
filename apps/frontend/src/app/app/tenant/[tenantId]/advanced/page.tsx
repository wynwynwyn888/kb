'use client';

import { PageHeader, SectionCard } from '@/components/app/mvp-ui';

export default function TenantAdvancedHubPage() {
  return (
    <div>
      <PageHeader title="Advanced" eyebrow="Operator shell" />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.55, maxWidth: '42rem' }}>
        One place for live connection checks, conversation activity, and routing diagnostics. Use the segment control above to move
        between screens without losing context—the same pages as before, grouped under <strong>Advanced</strong>.
      </p>

      <SectionCard title="What lives here" subtitle="Honest map to existing routes.">
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', color: '#475569', lineHeight: 1.55 }}>
          <li>
            <strong>GHL connection</strong> — read-only status and health for the GoHighLevel link (same data as the dedicated
            URL).
          </li>
          <li style={{ marginTop: '0.5rem' }}>
            <strong>Activity</strong> — conversation list and message viewer for this subaccount.
          </li>
          <li style={{ marginTop: '0.5rem' }}>
            <strong>Diagnostics</strong> — handovers, intents, and AI route probes exposed by the API.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
