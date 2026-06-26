'use client';

import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { maskPhone } from '@/lib/identifiers';
import { mockClients, mockProjects, statusPillColors } from '@/lib/mock-data';
import { useParams, useSearchParams } from 'next/navigation';

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const client = mockClients.find(c => c.clientKey === params.clientId);
  const projectId = searchParams.get('projectId');
  const project = mockProjects.find(p => p.projectId === projectId);

  if (!client) {
    return (
      <OnboardChrome>
        <h1>Client not found</h1>
        <p>No client matches &quot;{params.clientId}&quot;.</p>
      </OnboardChrome>
    );
  }

  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          <IdentifierLabel businessName={client.displayName} clientKey={client.clientKey} />
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
          <StatusPill status={client.status} />
          <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>
            {client.industry} · {maskPhone(client.contactPhone)} · {client.contactEmail}
          </span>
        </div>
      </div>

      {/* Client info card */}
      <PlaceholderCard title="Client Details">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.88rem' }}>
          <DetailRow label="Business Name" value={client.displayName} />
          <DetailRow label="Client Key" value={client.clientKey} />
          <DetailRow label="Contact Phone" value={maskPhone(client.contactPhone)} />
          <DetailRow label="Contact Email" value={client.contactEmail} />
          <DetailRow label="Industry" value={client.industry} />
          <DetailRow label="Status" value={client.status} />
        </div>
        <div style={{ marginTop: '1rem', padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.8rem', color: '#92400E' }}>
          GHL connection and identity map not connected — integration pending (PR 8+).
        </div>
      </PlaceholderCard>

      {/* Linked project */}
      {project && (
        <PlaceholderCard title={`Project: ${project.displayName} · ${project.clientKey}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <StatusPill status={project.status} />
            <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)' }}>
              {Math.round(project.completeness * 100)}% complete
            </span>
            {project.submittedAt && (
              <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>
                Submitted {new Date(project.submittedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Section status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {project.sections.map(section => (
              <div key={section.name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--aisbp-text, #0f172a)', minWidth: 140 }}>
                  {section.label}
                </span>
                <StatusPill status={section.status} />
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#E2E8F0', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(section.fieldsCompleted / section.fieldsTotal) * 100}%`,
                      height: '100%',
                      borderRadius: 3,
                      background: section.status === 'approved' ? '#16A34A' : '#2563EB',
                    }}
                  />
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', minWidth: 50, textAlign: 'right' }}>
                  {section.fieldsCompleted}/{section.fieldsTotal}
                </span>
              </div>
            ))}
          </div>

          {/* Missing fields */}
          {project.completeness < 1 && (
            <div style={{ marginTop: '1rem', padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.82rem', color: '#92400E' }}>
              Missing fields in:{' '}
              {project.sections.filter(s => s.status === 'empty' || s.status === 'partial').map(s => s.label).join(', ')}.
            </div>
          )}

          {/* Sync status */}
          {project.syncRuns.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Sync Runs</h3>
              {project.syncRuns.map(run => (
                <div key={run.syncRunId} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.35rem 0', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>{run.targetSystem.toUpperCase()}</span>
                  <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>{run.mode.replace('_', ' ')}</span>
                  <StatusPill status={run.status} />
                </div>
              ))}
            </div>
          )}
        </PlaceholderCard>
      )}

      {/* No project linked */}
      {!project && (
        <PlaceholderCard title="Project">
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
            No project linked. Create an onboarding project for this client (PR 4+).
          </p>
        </PlaceholderCard>
      )}
    </OnboardChrome>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: 'var(--aisbp-muted, #64748b)', fontSize: '0.78rem' }}>{label}</span>
      <div style={{ fontWeight: 600, color: 'var(--aisbp-text, #0f172a)' }}>{value}</div>
    </div>
  );
}
