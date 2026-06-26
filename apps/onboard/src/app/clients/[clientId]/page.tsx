'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { SafetyBanner } from '@/components/SafetyBanner';
import { useAuth } from '@/contexts/AuthContext';
import type { OnboardClient, OnboardProject, UpdateClientInput } from '@/types/onboard';
import { formatShortId } from '@/lib/identifiers';

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { api } = useAuth();
  const clientId = params.clientId;

  const [client, setClient] = useState<OnboardClient | null>(null);
  const [projects, setProjects] = useState<OnboardProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateClientInput>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  const fetchData = useCallback(() => {
    if (!api) return;
    setLoading(true);
    Promise.all([
      api.getClient(clientId),
      api.listProjects().then(ps => ps.filter(p => p.onboardClientId === clientId)),
    ])
      .then(([c, p]) => { setClient(c); setProjects(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api, clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleEdit = () => {
    if (!client) return;
    setEditForm({
      displayName: client.displayName,
      contactName: client.contactName || undefined,
      contactPhone: client.contactPhone || undefined,
      contactEmail: client.contactEmail || undefined,
      industry: client.industry || undefined,
      websiteUrl: client.websiteUrl || undefined,
    });
    setEditing(true);
    setEditError(null);
  };

  const handleSave = async () => {
    if (!api || !client) return;
    setSaving(true);
    setEditError(null);
    try {
      const updated = await api.updateClient(client.id, editForm);
      setClient(updated);
      setEditing(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateProject = async () => {
    if (!api || !client) return;
    setCreatingProject(true);
    setCreateProjectError(null);
    try {
      const project = await api.createProject({ onboardClientId: client.id });
      router.push(`/clients/${client.id}?projectId=${project.id}`);
    } catch (err: unknown) {
      setCreateProjectError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreatingProject(false);
    }
  };

  if (loading) {
    return <OnboardChrome><p style={{ color: 'var(--aisbp-muted, #64748b)' }}>Loading client...</p></OnboardChrome>;
  }

  if (!client) {
    return <OnboardChrome><h1 style={{ color: 'var(--aisbp-text, #0f172a)' }}>Client not found</h1><p style={{ color: 'var(--aisbp-muted, #64748b)' }}>No client matches &quot;{clientId}&quot;.</p></OnboardChrome>;
  }

  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
              <IdentifierLabel businessName={client.displayName} clientKey={client.clientKey} />
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
              <StatusPill status={client.status} />
              <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>
                ID: {formatShortId(client.id)} · {client.industry || 'No industry'}
              </span>
            </div>
          </div>
          {!editing && (
            <button type="button" onClick={handleEdit} style={{
              padding: '0.45rem 1rem', borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)',
              background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)',
              fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
            }}>
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <PlaceholderCard title="Edit Client">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <DetailField label="Business Name" value={editForm.displayName || ''} onChange={v => setEditForm(s => ({ ...s, displayName: v }))} />
            <DetailField label="Contact Name" value={editForm.contactName || ''} onChange={v => setEditForm(s => ({ ...s, contactName: v || undefined }))} />
            <DetailField label="Contact Phone" value={editForm.contactPhone || ''} onChange={v => setEditForm(s => ({ ...s, contactPhone: v || undefined }))} />
            <DetailField label="Contact Email" value={editForm.contactEmail || ''} onChange={v => setEditForm(s => ({ ...s, contactEmail: v || undefined }))} />
            <DetailField label="Industry" value={editForm.industry || ''} onChange={v => setEditForm(s => ({ ...s, industry: v || undefined }))} />
            <DetailField label="Website" value={editForm.websiteUrl || ''} onChange={v => setEditForm(s => ({ ...s, websiteUrl: v || undefined }))} />
          </div>
          {editError && <div style={{ padding: '0.5rem 0.75rem', background: '#FEE2E2', borderRadius: 8, fontSize: '0.82rem', color: '#DC2626', marginBottom: '1rem' }}>{editError}</div>}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '0.45rem 1.25rem', borderRadius: 10, background: '#2563EB', color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.82rem', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} style={{ padding: '0.45rem 1.25rem', borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)', background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </PlaceholderCard>
      )}

      {/* Client info */}
      <PlaceholderCard title="Client Details">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.88rem' }}>
          <DetailRow label="Business Name" value={client.displayName} />
          <DetailRow label="Client Key" value={client.clientKey} />
          <DetailRow label="Contact Phone" value={client.contactPhoneMasked || '--'} />
          <DetailRow label="Contact Email" value={client.contactEmail || '--'} />
          <DetailRow label="Industry" value={client.industry || '--'} />
          <DetailRow label="Time Zone" value={client.timezone || '--'} />
          <DetailRow label="Status" value={client.status} />
          <DetailRow label="Projects" value={String(client.projectCount)} />
        </div>
      </PlaceholderCard>

      {/* Projects */}
      <PlaceholderCard title="Projects">
        {projects.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {projects.map(project => (
              <div
                key={project.id}
                onClick={() => router.push(`/clients/${client.id}?projectId=${project.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.65rem 0.85rem',
                  borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)',
                  background: 'var(--aisbp-surface, #fff)', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--aisbp-text, #0f172a)' }}>
                  Project {formatShortId(project.id)}
                </span>
                <StatusPill status={project.status} />
                <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
                  Phase: {project.currentPhase}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 1rem' }}>
            No projects yet for this client.
          </p>
        )}

        {!showCreateProject ? (
          <button type="button" onClick={() => setShowCreateProject(true)} style={{
            padding: '0.45rem 1.25rem', borderRadius: 10, border: 'none',
            background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
          }}>
            + Create Project
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button type="button" onClick={handleCreateProject} disabled={creatingProject} style={{
              padding: '0.45rem 1.25rem', borderRadius: 10, border: 'none',
              background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: creatingProject ? 'not-allowed' : 'pointer',
            }}>
              {creatingProject ? 'Creating...' : 'Confirm Create Project'}
            </button>
            <button type="button" onClick={() => setShowCreateProject(false)} style={{
              padding: '0.45rem 1.25rem', borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)',
              background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)',
              fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
            }}>
              Cancel
            </button>
          </div>
        )}
        {createProjectError && <div style={{ padding: '0.5rem 0.75rem', background: '#FEE2E2', borderRadius: 8, fontSize: '0.82rem', color: '#DC2626', marginTop: '0.75rem' }}>{createProjectError}</div>}
      </PlaceholderCard>

      {/* Future sections */}
      <PlaceholderCard title="Onboarding Sections">
        <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
          Section editing and approval comes in future PRs:
        </p>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)' }}>
          <li>Business Profile</li>
          <li>Sales Process</li>
          <li>FAQs</li>
          <li>Prompt Config</li>
          <li>Handover Rules</li>
          <li>Follow-Up Rules</li>
          <li>Automation Recommendations</li>
        </ul>
      </PlaceholderCard>
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

function DetailField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--aisbp-text, #0f172a)' }}>{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '0.45rem 0.65rem', borderRadius: 8,
          border: '1px solid var(--aisbp-border, #e2e8f0)', fontSize: '0.85rem',
          background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}
