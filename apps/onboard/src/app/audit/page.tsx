'use client';

import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';

export default function AuditLogPage() {
  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          Audit Log
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
          Chronological record of all write operations
        </p>
      </div>

      <PlaceholderCard title="Event Timeline">
        <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
          Audit events are recorded in the audit_events table by the backend module (PR 4).
          Full audit UI with filtering and timeline is future.
        </p>
      </PlaceholderCard>

      <div style={{ marginTop: '1rem', padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.82rem', color: '#92400E' }}>
        Audit logging is active in PR 4 backend. Full audit log display UI is future.
      </div>
    </OnboardChrome>
  );
}
