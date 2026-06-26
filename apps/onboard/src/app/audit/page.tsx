'use client';

import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { mockProjects } from '@/lib/mock-data';

export default function AuditLogPage() {
  const allEvents = mockProjects.flatMap(p =>
    p.auditEvents.map(e => ({ ...e, projectDisplay: `${p.displayName} · ${p.clientKey}` }))
  );

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
        {allEvents.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {allEvents.map((event, i) => (
              <div
                key={event.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.6rem 0',
                  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
                }}
              >
                <span style={{ fontSize: '0.85rem', minWidth: 90, color: 'var(--aisbp-muted, #64748b)' }}>
                  {new Date(event.createdAt).toLocaleTimeString()}
                </span>
                <span style={{
                  fontSize: '0.78rem', fontWeight: 700, minWidth: 55,
                  padding: '0.1rem 0.35rem', borderRadius: 6, textAlign: 'center',
                  background: event.actorType === 'agent' ? '#DBEAFE' : '#DCFCE7',
                  color: event.actorType === 'agent' ? '#1E40AF' : '#16A34A',
                }}>
                  {event.actorType}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-text, #0f172a)', flex: 1 }}>
                  {event.projectDisplay} — {event.action.replace('.', ' ')}
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
                  {event.resourceType}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
            No audit events recorded yet.
          </p>
        )}
      </PlaceholderCard>

      <div style={{ marginTop: '1rem', padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.82rem', color: '#92400E' }}>
        Static mock data. Full audit logging will be implemented in PR 3+ alongside the backend module.
      </div>
    </OnboardChrome>
  );
}
