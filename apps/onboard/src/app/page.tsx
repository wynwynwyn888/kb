'use client';

import { useState, useEffect } from 'react';
import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { maskPhone } from '@/lib/identifiers';
import { useAuth } from '@/contexts/AuthContext';
import type { OnboardClient, OnboardProject } from '@/types/onboard';
import Link from 'next/link';

export default function DashboardPage() {
  const { api } = useAuth();
  const [clients, setClients] = useState<OnboardClient[]>([]);
  const [projects, setProjects] = useState<OnboardProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) return;
    Promise.all([api.listClients(), api.listProjects()])
      .then(([c, p]) => { setClients(c); setProjects(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  const pendingReview = projects.filter(p => p.status === 'SUBMITTED' || p.status === 'IN_REVIEW');
  const liveCount = projects.filter(p => p.status === 'LIVE' || p.status === 'SYNCING').length;

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

      {loading ? (
        <p style={{ color: 'var(--aisbp-muted, #64748b)' }}>Loading...</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <StatCard label="Projects" value={projects.length} color="#2563EB" />
            <StatCard label="Needs Review" value={pendingReview.length} color="#D97706" />
            <StatCard label="Live Clients" value={liveCount} color="#16A34A" />
            <StatCard label="Clients" value={clients.length} color="#0F62FE" />
          </div>

          <PlaceholderCard title="Projects">
            {projects.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {projects.slice(0, 5).map(project => (
                  <Link
                    key={project.id}
                    href={`/clients/${project.onboardClientId}?projectId=${project.id}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.65rem 0.85rem',
                      borderRadius: 10, textDecoration: 'none', color: 'inherit',
                      border: '1px solid var(--aisbp-border, #e2e8f0)',
                      background: 'var(--aisbp-surface, #fff)',
                    }}
                  >
                    <IdentifierLabel businessName={project.displayLabel || project.clientKey} clientKey={project.clientKey} />
                    <StatusPill status={project.status} />
                  </Link>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
                No projects yet. Create your first client and project to get started.
              </p>
            )}
          </PlaceholderCard>

          <PlaceholderCard title="Clients">
            {clients.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {clients.slice(0, 5).map(client => (
                  <Link
                    key={client.id}
                    href={`/clients/${client.id}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.65rem 0.85rem',
                      borderRadius: 10, textDecoration: 'none', color: 'inherit',
                      border: '1px solid var(--aisbp-border, #e2e8f0)',
                      background: 'var(--aisbp-surface, #fff)',
                    }}
                  >
                    <IdentifierLabel businessName={client.displayName} clientKey={client.clientKey} />
                    <StatusPill status={client.status} />
                    <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', marginLeft: 'auto' }}>
                      {client.contactPhoneMasked}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
                No clients yet. Create your first client to begin onboarding.
              </p>
            )}
          </PlaceholderCard>
        </>
      )}
    </OnboardChrome>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: 'var(--aisbp-surface, #ffffff)', border: '1px solid var(--aisbp-border, #e2e8f0)',
      borderRadius: 14, padding: '1.25rem', textAlign: 'center',
    }}>
      <div style={{ fontSize: '2rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', marginTop: '0.25rem' }}>{label}</div>
    </div>
  );
}
