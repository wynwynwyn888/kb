'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createSubaccount,
  deleteSubaccount,
  getGhlConnection,
  getTenantsByAgency,
} from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  mvpInputStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';

type TenantRow = {
  id: string;
  name: string;
  ghlLocationId?: string | null;
  status: string;
};

export default function AgencyTenantDirectoryPage() {
  const { token, user } = useAuth();
  const [q, setQ] = useState('');
  const [list, setList] = useState<TenantRow[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [newName, setNewName] = useState('');
  const [newGhlLocationId, setNewGhlLocationId] = useState('');
  const [createOk, setCreateOk] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TenantRow | null>(null);
  const [deleteOk, setDeleteOk] = useState('');
  const [ghlById, setGhlById] = useState<
    Record<string, { status: string; connected: boolean; maskToken?: string } | null>
  >({});

  const load = async () => {
    const agencyId = user?.agencyId;
    if (!token || !agencyId) return;
    setLoading(true);
    setErr('');
    try {
      const t = await getTenantsByAgency(token, agencyId);
      setList(t);
      const g = await Promise.all(
        t.map(x => getGhlConnection(token, x.id).catch(() => null)),
      );
      const next: Record<string, { status: string; connected: boolean; maskToken?: string } | null> = {};
      t.forEach((x, i) => {
        const c = g[i];
        next[x.id] = c
          ? { status: c.status, connected: c.connected, maskToken: c.maskToken }
          : null;
      });
      setGhlById(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAttempt refresh
  }, [token, user?.agencyId, loadAttempt]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(t => t.name.toLowerCase().includes(s));
  }, [list, q]);

  const onCreate = async () => {
    if (!token || !user?.agencyId || !newName.trim()) return;
    setCreating(true);
    setErr('');
    setCreateOk('');
    try {
      const g = newGhlLocationId.trim();
      const created = await createSubaccount(token, {
        agencyId: user.agencyId,
        name: newName.trim(),
        ...(g ? { ghlLocationId: g } : {}),
      });
      setNewName('');
      setNewGhlLocationId('');
      setCreateOk(`Created workspace “${created.name}”.`);
      setLoadAttempt(a => a + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const openDeleteModal = (row: TenantRow) => {
    setErr('');
    setDeleteOk('');
    setDeleteConfirm(row);
  };

  const onConfirmDelete = async () => {
    if (!token || !deleteConfirm) return;
    const removedId = deleteConfirm.id;
    setDeletingId(removedId);
    setErr('');
    setDeleteOk('');
    try {
      await deleteSubaccount(token, removedId);
      setList(prev => prev.filter(t => t.id !== removedId));
      setGhlById(prev => {
        const n = { ...prev };
        delete n[removedId];
        return n;
      });
      setDeleteConfirm(null);
      setDeleteOk('Workspace removed.');
      setLoadAttempt(a => a + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Client Workspaces" eyebrow="Agency account" />
      {deleteOk ? (
        <p style={{ fontSize: '0.86rem', color: '#166534', margin: '0 0 0.75rem', fontWeight: 600 }}>{deleteOk}</p>
      ) : null}
      <p style={{ fontSize: '0.83rem', color: '#64748b', margin: '0 0 0.75rem', lineHeight: 1.45, maxWidth: '40rem' }}>
        Create and manage the client workspaces connected to CRM.
      </p>

      <SectionCard
        title="Create workspace"
        subtitle="Start with a workspace name. You can connect CRM now or later."
      >
        {createOk ? (
          <p style={{ fontSize: '0.86rem', color: '#166534', margin: '0 0 0.75rem', fontWeight: 600 }}>{createOk}</p>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '480px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <input
              value={newName}
              onChange={e => {
                setNewName(e.target.value);
                setCreateOk('');
                setDeleteOk('');
              }}
              placeholder="Workspace name"
              style={{ ...mvpInputStyle, flex: '1 1 200px', minWidth: '200px' }}
              aria-label="New workspace name"
            />
            <button
              type="button"
              disabled={creating || !newName.trim()}
              onClick={() => void onCreate()}
              style={{ ...mvpPrimaryButtonStyle, opacity: creating || !newName.trim() ? 0.6 : 1 }}
            >
              {creating ? 'Creating…' : 'Create workspace'}
            </button>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>
              CRM location ID (optional)
            </label>
            <input
              value={newGhlLocationId}
              onChange={e => {
                setNewGhlLocationId(e.target.value);
                setCreateOk('');
              }}
              placeholder="Location ID from CRM"
              style={{ ...mvpInputStyle, maxWidth: '100%' }}
              autoComplete="off"
              aria-label="Optional CRM location ID for new workspace"
            />
          </div>
        </div>
      </SectionCard>

      {err ? (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorBanner message={err} />
          <button
            type="button"
            onClick={() => {
              setErr('');
              setLoadAttempt(a => a + 1);
            }}
            style={{
              marginTop: '0.5rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      <SectionCard title="Search" subtitle="Filter by name.">
        <input
          type="search"
          placeholder="Search by name"
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Search workspaces"
          style={{ ...mvpInputStyle, maxWidth: '400px' }}
        />
      </SectionCard>

      {loading ? (
        <LoadingBlock message="Loading…" />
      ) : err && list.length === 0 ? null : list.length === 0 ? (
        <EmptyState title="No workspaces yet" detail="Create the first client workspace above." />
      ) : (
        <SectionCard title={`Workspaces (${filtered.length}${filtered.length !== list.length ? ` of ${list.length}` : ''})`}>
          {filtered.length === 0 ? (
            <EmptyState title="No matches" detail="Try a different search term." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '920px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5' }}>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>Workspace</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>Status</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>CRM</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>AI setup</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <TenantNameRow
                      key={t.id}
                      t={t}
                      ghl={ghlById[t.id] ?? null}
                      onRequestDelete={openDeleteModal}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
      {deleteConfirm ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-subaccount-title"
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '1.25rem 1.35rem',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
            }}
          >
            <h2 id="delete-subaccount-title" style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 0.5rem', color: '#0f172a' }}>
              Delete workspace?
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#475569', lineHeight: 1.5, margin: '0 0 1.1rem' }}>
              This will remove the workspace record. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  if (!deletingId) setDeleteConfirm(null);
                }}
                disabled={deletingId !== null}
                style={{
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.86rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  cursor: deletingId ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onConfirmDelete()}
                disabled={deletingId !== null}
                style={{
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.86rem',
                  borderRadius: '6px',
                  border: '1px solid #b91c1c',
                  background: '#b91c1c',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: deletingId ? 'not-allowed' : 'pointer',
                }}
              >
                {deletingId ? 'Deleting…' : 'Delete workspace'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TenantNameRow({
  t,
  ghl,
  onRequestDelete,
}: {
  t: TenantRow;
  ghl: { status: string; connected: boolean; maskToken?: string } | null;
  onRequestDelete: (row: TenantRow) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', background: '#fff' }}>
      <td style={{ padding: '0.75rem 0.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-start' }}>
          <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>{t.name}</span>
          <Link
            href={`/app/tenant/${t.id}/control-panel`}
            style={{ fontSize: '0.78rem', fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}
          >
            Rename in workspace settings →
          </Link>
        </div>
        <details
          style={{ marginTop: '0.4rem' }}
          onToggle={e => {
            setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open);
          }}
        >
          <summary style={{ fontSize: '0.7rem', color: '#94a3b8', cursor: 'pointer', listStyle: 'none' } as CSSProperties}>
            Advanced details
          </summary>
          {advancedOpen ? (
            <p
              style={{
                fontSize: '0.68rem',
                color: '#64748b',
                fontFamily: 'inherit',
                margin: '0.3rem 0 0',
                lineHeight: 1.35,
                wordBreak: 'break-all',
              } as CSSProperties}
            >
              Workspace ID: {t.id}
            </p>
          ) : null}
        </details>
      </td>
      <td style={{ padding: '0.75rem 0.5rem' }}>
        <StatusPill label={t.status === 'ACTIVE' ? 'Active' : t.status} tone="neutral" />
      </td>
      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.8rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {ghl ? (
            <StatusPill
              label={ghl.connected && ghl.status === 'CONNECTED' ? 'Connected' : ghl.status === 'DISCONNECTED' ? 'Needs setup' : 'Needs review'}
              tone={ghl.connected && ghl.status === 'CONNECTED' ? 'ok' : ghl.status === 'DISCONNECTED' ? 'warn' : 'bad'}
            />
          ) : (
            <StatusPill label="Needs setup" tone="warn" />
          )}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: '#64748b' }}>Support details</summary>
            <p style={{ margin: '0.35rem 0 0', fontFamily: 'inherit', fontSize: '0.72rem', color: '#64748b', wordBreak: 'break-all' }}>
              CRM location ID: {t.ghlLocationId && String(t.ghlLocationId).trim() ? t.ghlLocationId : '—'}
              <br />
              Token: {ghl?.maskToken ?? '—'}
            </p>
          </details>
        </div>
      </td>
      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.8rem' }}>
        <StatusPill label="Agency defaults" tone="neutral" />
      </td>
      <td style={{ padding: '0.75rem 0.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <Link
            href={`/app/tenant/${t.id}`}
            style={{
              display: 'inline-block',
              padding: '0.35rem 0.65rem',
              borderRadius: '6px',
              background: '#0070f3',
              color: '#fff',
              textDecoration: 'none',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            Open workspace
          </Link>
          <Link
            href={`/app/agency/settings/ghl?subaccount=${encodeURIComponent(t.id)}`}
            style={{
              display: 'inline-block',
              padding: '0.35rem 0.65rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              color: '#1a1a1a',
              textDecoration: 'none',
              fontSize: '0.82rem',
            }}
          >
            Connect CRM
          </Link>
          <button
            type="button"
            onClick={() => onRequestDelete(t)}
            style={{
              display: 'inline-block',
              padding: '0.35rem 0.65rem',
              borderRadius: '6px',
              border: '1px solid #fecaca',
              background: '#fff1f2',
              color: '#b91c1c',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
