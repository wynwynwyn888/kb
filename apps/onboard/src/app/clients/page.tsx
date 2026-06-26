'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { useAuth } from '@/contexts/AuthContext';
import type { OnboardClient, CreateClientInput } from '@/types/onboard';
import Link from 'next/link';

export default function ClientsPage() {
  const { api } = useAuth();
  const router = useRouter();
  const [clients, setClients] = useState<OnboardClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [form, setForm] = useState<CreateClientInput>({ clientKey: '', displayName: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchClients = useCallback(() => {
    if (!api) return;
    api.listClients().then(setClients).catch(() => {    }).finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await api.createClient(form);
      setShowCreate(false);
      setForm({ clientKey: '', displayName: '' });
      setLoading(true);
      fetchClients();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create client';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
            Clients
          </h1>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
            All onboarded client businesses
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: '0.55rem 1.25rem', borderRadius: 10, border: 'none',
            background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          {showCreate ? 'Cancel' : '+ New Client'}
        </button>
      </div>

      {showCreate && (
        <PlaceholderCard title="Create Client">
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <FormField label="Client Key *" value={form.clientKey} onChange={v => setForm(s => ({ ...s, clientKey: v }))} placeholder="dapperdogs" />
              <FormField label="Business Name *" value={form.displayName} onChange={v => setForm(s => ({ ...s, displayName: v }))} placeholder="Dapper Dogs" />
              <FormField label="Contact Name" value={form.contactName || ''} onChange={v => setForm(s => ({ ...s, contactName: v || undefined }))} />
              <FormField label="Contact Phone" value={form.contactPhone || ''} onChange={v => setForm(s => ({ ...s, contactPhone: v || undefined }))} placeholder="+6587651234" />
              <FormField label="Contact Email" value={form.contactEmail || ''} onChange={v => setForm(s => ({ ...s, contactEmail: v || undefined }))} />
              <FormField label="Industry" value={form.industry || ''} onChange={v => setForm(s => ({ ...s, industry: v || undefined }))} />
            </div>
            {formError && <div style={{ padding: '0.5rem 0.75rem', background: '#FEE2E2', borderRadius: 8, fontSize: '0.82rem', color: '#DC2626', marginBottom: '1rem' }}>{formError}</div>}
            <button type="submit" disabled={submitting} style={{
              padding: '0.55rem 1.25rem', borderRadius: 10, border: 'none',
              background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1,
            }}>
              {submitting ? 'Creating...' : 'Create Client'}
            </button>
          </form>
        </PlaceholderCard>
      )}

      <PlaceholderCard title="Client List">
        {loading ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>Loading clients...</p>
        ) : clients.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {clients.map(client => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.65rem 0.85rem',
                  borderRadius: 10, textDecoration: 'none', color: 'inherit',
                  border: '1px solid var(--aisbp-border, #e2e8f0)', background: 'var(--aisbp-surface, #fff)',
                }}
              >
                <IdentifierLabel businessName={client.displayName} clientKey={client.clientKey} />
                <StatusPill status={client.status} />
                <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>
                  {client.contactPhoneMasked || '--'}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', marginLeft: 'auto' }}>
                  {client.industry || ''}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
            No clients yet. Click &quot;+ New Client&quot; to create one.
          </p>
        )}
      </PlaceholderCard>
    </OnboardChrome>
  );
}

function FormField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--aisbp-text, #0f172a)' }}>{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
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
