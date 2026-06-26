'use client';

import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { maskPhone } from '@/lib/identifiers';
import { mockProjects, mockClients } from '@/lib/mock-data';
import Link from 'next/link';

export default function DashboardPage() {
  const pendingReview = mockProjects.filter(p => p.status === 'in_review' || p.status === 'submitted');
  const liveCount = mockProjects.filter(p => p.status === 'live' || p.status === 'syncing').length;

  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          Dashboard
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
          Overview of all client onboarding projects
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard label="Projects" value={mockProjects.length} color="#2563EB" />
        <StatCard label="Needs Review" value={pendingReview.length} color="#D97706" />
        <StatCard label="Live Clients" value={liveCount} color="#16A34A" />
        <StatCard label="Clients" value={mockClients.length} color="#0F62FE" />
      </div>

      {/* Recent Activity */}
      <PlaceholderCard title="Recent Activity">
        {mockProjects[0] && mockProjects[0].auditEvents.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {mockProjects[0].auditEvents.map(event => (
              <div
                key={event.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
                }}
              >
                <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', minWidth: 90 }}>
                  {event.actorType === 'agent' ? '🤖 Agent' : '👤 Wyn'}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-text, #0f172a)', flex: 1 }}>
                  Dapper Dogs · dapperdogs — {event.action.replace('.', ' ')}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--aisbp-muted, #64748b)' }}>
                  {new Date(event.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
            No activity yet. Activity will appear here after agent intake begins.
          </p>
        )}
      </PlaceholderCard>

      {/* Projects quick list */}
      <PlaceholderCard title="Projects">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {mockProjects.map(project => (
            <Link
              key={project.projectId}
              href={`/clients/${project.clientKey}?projectId=${project.projectId}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.65rem 0.85rem',
                borderRadius: 10,
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid var(--aisbp-border, #e2e8f0)',
                background: 'var(--aisbp-surface, #fff)',
              }}
            >
              <IdentifierLabel businessName={project.displayName} clientKey={project.clientKey} />
              <StatusPill status={project.status} />
              <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', marginLeft: 'auto' }}>
                {Math.round(project.completeness * 100)}% complete
              </span>
            </Link>
          ))}
        </div>
      </PlaceholderCard>
    </OnboardChrome>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        background: 'var(--aisbp-surface, #ffffff)',
        border: '1px solid var(--aisbp-border, #e2e8f0)',
        borderRadius: 14,
        padding: '1.25rem',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '2rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', marginTop: '0.25rem' }}>{label}</div>
    </div>
  );
}
