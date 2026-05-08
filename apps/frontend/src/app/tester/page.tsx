/**
 * Internal route. Do not expose to client users.
 * Keeping the route for backwards compatibility; agency staff only.
 */

'use client';

import { AgencyOnlyGate } from '@/components/app/AgencyOnlyGate';
import { PageHeader, SectionCard } from '@/components/app/mvp-ui';

export default function BotTesterPage() {
  return (
    <AgencyOnlyGate>
      <div style={{ maxWidth: 760 }}>
        <PageHeader title="Assistant Preview" eyebrow="Agency" />
        <SectionCard
          title="This tool is agency-only"
          subtitle="This page is not intended for client workspaces. Use the in-workspace Assistant → Preview screen instead."
        >
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.5 }}>
            If you reached this page from an old link, you can return to the app entry route and choose the right workspace.
          </p>
        </SectionCard>
      </div>
    </AgencyOnlyGate>
  );
}