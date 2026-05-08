/**
 * Legacy/internal route kept for backwards compatibility.
 * Client workspaces should use `/app/tenant/:tenantId/usage` and agencies should use `/app/agency/settings/quotas`.
 */

'use client';

import { AgencyOnlyGate } from '@/components/app/AgencyOnlyGate';
import { PageHeader, SectionCard } from '@/components/app/mvp-ui';

export default function CreditsPage() {
  return (
    <AgencyOnlyGate>
      <div style={{ maxWidth: 760 }}>
        <PageHeader title="Credits" eyebrow="Agency" />
        <SectionCard title="This page has moved" subtitle="Use the Credits pages inside the app.">
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.5 }}>
            For agencies: open <strong>Agency → Credits</strong>. For workspaces: open <strong>Usage</strong> in the sidebar.
          </p>
        </SectionCard>
      </div>
    </AgencyOnlyGate>
  );
}