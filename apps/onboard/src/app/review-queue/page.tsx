'use client';

import { useState, useEffect } from 'react';
import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { useAuth } from '@/contexts/AuthContext';
import type { OnboardProject } from '@/types/onboard';
import { useRouter } from 'next/navigation';

export default function ReviewQueuePage() {
  const { api } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<OnboardProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) return;
    api.listProjects()
      .then(ps => setProjects(ps.filter(p => p.status === 'SUBMITTED' || p.status === 'IN_REVIEW')))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  const pending = projects.filter(p => p.status === 'SUBMITTED' || p.status === 'IN_REVIEW');

  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          Review Queue
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
          Projects submitted by agent, awaiting your review
        </p>
        {pending.length > 0 && (
          <span style={{ display: 'inline-block', marginTop: '0.5rem', padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 700, background: '#FEF3C7', color: '#D97706' }}>
            {pending.length} pending
          </span>
        )}
      </div>

      <PlaceholderCard title="Awaiting Review">
        {loading ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>Loading...</p>
        ) : pending.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pending.map(project => (
              <div
                key={project.id}
                onClick={() => router.push(`/clients/${project.onboardClientId}?projectId=${project.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 0.85rem',
                  borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)',
                  background: 'var(--aisbp-surface, #fff)', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '1.25rem' }}>🟡</span>
                <div style={{ flex: 1 }}>
                  <IdentifierLabel businessName={project.displayLabel || project.clientKey} clientKey={project.clientKey} />
                  <div style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', marginTop: '0.15rem' }}>
                    Phase: {project.currentPhase} · v{project.version}
                  </div>
                </div>
                <StatusPill status={project.status} />
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
            No projects awaiting review.
          </p>
        )}
      </PlaceholderCard>

      <div style={{ marginTop: '1rem', padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.82rem', color: '#92400E' }}>
        Approval workflow is future (PR 6+). MVP: Wyn checks the review queue manually. External notifications are future (PR 11).
      </div>
    </OnboardChrome>
  );
}
