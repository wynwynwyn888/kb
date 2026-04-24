'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createSubaccount,
  deleteSubaccount,
  getGhlConnection,
  getTenantsByAgency,
  updateSubaccountName,
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
  const [savingId, setSavingId] = useState<string | null>(null);
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
      setErr(e instanceof Error ? e.message : 'Failed to load subaccounts');
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
      setCreateOk(`Created subaccount “${created.name}”.`);
      setLoadAttempt(a => a + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const onSaveName = async (id: string, name: string) => {
    if (!token || !name.trim()) return;
    setSavingId(id);
    setErr('');
    try {
      await updateSubaccountName(token, id, name.trim());
      setLoadAttempt(a => a + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Rename failed');
    } finally {
      setSavingId(null);
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
      setDeleteOk('Subaccount removed.');
      setLoadAttempt(a => a + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Subaccounts" eyebrow="Agency account" />
      {deleteOk ? (
        <p style={{ fontSize: '0.86rem', color: '#166534', margin: '0 0 0.75rem', fontWeight: 600 }}>{deleteOk}</p>
      ) : null}
      <p style={{ fontSize: '0.83rem', color: '#64748b', margin: '0 0 0.75rem', lineHeight: 1.45, maxWidth: '40rem' }}>
        One subaccount per client or line of business. GHL location id is optional; set it here or in Integrations.
      </p>

      <SectionCard
        title="Create subaccount"
        subtitle="Name is required. GHL location id is optional; you can connect tokens per subaccount in Integrations."
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
              placeholder="Subaccount name (required)"
              style={{ ...mvpInputStyle, flex: '1 1 200px', minWidth: '200px' }}
              aria-label="New subaccount name"
            />
            <button
              type="button"
              disabled={creating || !newName.trim()}
              onClick={() => void onCreate()}
              style={{ ...mvpPrimaryButtonStyle, opacity: creating || !newName.trim() ? 0.6 : 1 }}
            >
              {creating ? 'Creating…' : 'Create subaccount'}
            </button>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>
              GHL location id (optional)
            </label>
            <input
              value={newGhlLocationId}
              onChange={e => {
                setNewGhlLocationId(e.target.value);
                setCreateOk('');
              }}
              placeholder="e.g. location id from HighLevel"
              style={{ ...mvpInputStyle, maxWidth: '100%' }}
              autoComplete="off"
              aria-label="Optional GHL location id for new subaccount"
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
          aria-label="Search subaccounts"
          style={{ ...mvpInputStyle, maxWidth: '400px' }}
        />
      </SectionCard>

      {loading ? (
        <LoadingBlock message="Loading…" />
      ) : err && list.length === 0 ? null : list.length === 0 ? (
        <EmptyState title="No subaccounts" detail="None are visible for this agency account yet." />
      ) : (
        <SectionCard title={`Subaccounts (${filtered.length}${filtered.length !== list.length ? ` of ${list.length}` : ''})`}>
          {filtered.length === 0 ? (
            <EmptyState title="No matches" detail="Try a different search term." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '920px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5' }}>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>Name</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>Status</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>GHL location id</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>Integration</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>Token</th>
                    <th style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: '#444' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <TenantNameRow
                      key={t.id}
                      t={t}
                      ghl={ghlById[t.id] ?? null}
                      savingId={savingId}
                      onSave={onSaveName}
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
              Delete subaccount?
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#475569', lineHeight: 1.5, margin: '0 0 1.1rem' }}>
              This will remove the subaccount record. This cannot be undone.
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
                {deletingId ? 'Deleting…' : 'Delete subaccount'}
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
  savingId,
  onSave,
  onRequestDelete,
}: {
  t: TenantRow;
  ghl: { status: string; connected: boolean; maskToken?: string } | null;
  savingId: string | null;
  onSave: (id: string, name: string) => void | Promise<void>;
  onRequestDelete: (row: TenantRow) => void;
}) {
  const [name, setName] = useState(t.name);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    setName(t.name);
  }, [t.name, t.id]);

  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', background: '#fff' }}>
      <td style={{ padding: '0.75rem 0.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ ...mvpInputStyle, maxWidth: '200px', fontWeight: 600 }}
            aria-label="Subaccount name"
          />
          <button
            type="button"
            disabled={savingId === t.id || name.trim() === t.name}
            onClick={() => void onSave(t.id, name)}
            style={{
              fontSize: '0.75rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              cursor: savingId === t.id ? 'wait' : 'pointer',
            }}
          >
            {savingId === t.id ? '…' : 'Save'}
          </button>
        </div>
        <details
          style={{ marginTop: '0.4rem' }}
          onToggle={e => {
            setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open);
          }}
        >
          <summary style={{ fontSize: '0.7rem', color: '#94a3b8', cursor: 'pointer', listStyle: 'none' } as CSSProperties}>
            Advanced (support)
          </summary>
          {advancedOpen ? (
            <p
              style={{
                fontSize: '0.68rem',
                color: '#64748b',
                fontFamily: 'ui-monospace, monospace',
                margin: '0.3rem 0 0',
                lineHeight: 1.35,
                wordBreak: 'break-all',
              } as CSSProperties}
            >
              Record id: {t.id}
            </p>
          ) : null}
        </details>
      </td>
      <td style={{ padding: '0.75rem 0.5rem' }}>
        <StatusPill label={t.status} tone="neutral" />
      </td>
      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.8rem', fontFamily: 'ui-monospace, monospace' }}>
        {t.ghlLocationId && String(t.ghlLocationId).trim() ? t.ghlLocationId : '—'}
      </td>
      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.8rem' }}>
        {ghl ? (
          <span style={{ fontWeight: 600, color: ghl.connected && ghl.status === 'CONNECTED' ? '#166534' : '#64748b' }}>
            {ghl.status}
          </span>
        ) : (
          <span style={{ color: '#94a3b8' }}>—</span>
        )}
      </td>
      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.8rem' }}>
        <Link
          href={`/app/agency/settings/ghl?subaccount=${encodeURIComponent(t.id)}`}
          style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
        >
          {ghl?.maskToken ? ghl.maskToken : 'Set token'}
        </Link>
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
            GHL connection
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
