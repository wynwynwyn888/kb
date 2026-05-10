'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createSubaccount,
  deleteSubaccount,
  ensureAgencySystemWorkspace,
  getGhlConnection,
  getQuotaAgencySettings,
  getTenantsByAgency,
  type WorkspaceListItem,
} from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  mvpButtonStyle,
  mvpFieldHint,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';

type TenantRow = WorkspaceListItem;

// Hard fallback used only when the agency credit settings request fails or returns no value.
// The agency-configured default is preferred when available.
const FALLBACK_INITIAL_CREDITS = 36000;
const ANNUAL_PLAN_OPTIONS = [{ months: 12, label: '1 year' }];

export default function AgencyTenantDirectoryPage() {
  const { token, user } = useAuth();
  const [q, setQ] = useState('');
  const [list, setList] = useState<TenantRow[]>([]);
  const [systemWorkspace, setSystemWorkspace] = useState<TenantRow | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [newName, setNewName] = useState('');
  const [newGhlLocationId, setNewGhlLocationId] = useState('');
  const [newAnnualMonths, setNewAnnualMonths] = useState<number>(12);
  // Defaults to fallback so the modal always opens with a sane number even before settings load.
  const [agencyDefaultCredits, setAgencyDefaultCredits] = useState<number>(FALLBACK_INITIAL_CREDITS);
  const [newInitialCredits, setNewInitialCredits] = useState<string>(String(FALLBACK_INITIAL_CREDITS));
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');

  const [createOk, setCreateOk] = useState('');
  const [creating, setCreating] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TenantRow | null>(null);
  const [deleteClientAcknowledged, setDeleteClientAcknowledged] = useState(false);
  const [deletePhraseInput, setDeletePhraseInput] = useState('');
  const [deleteOk, setDeleteOk] = useState('');
  const [ghlById, setGhlById] = useState<
    Record<string, { status: string; connected: boolean; maskToken?: string } | null>
  >({});
  const [ensuringSystem, setEnsuringSystem] = useState(false);

  const load = async () => {
    const agencyId = user?.agencyId;
    if (!token || !agencyId) return;
    setLoading(true);
    setErr('');
    try {
      const t = await getTenantsByAgency(token, agencyId);
      const system = t.find(x => x.isAgencyWorkspace) ?? null;
      const clientWorkspaces = t.filter(x => !x.isAgencyWorkspace);
      setSystemWorkspace(system);
      setList(clientWorkspaces);
      const all = system ? [system, ...clientWorkspaces] : clientWorkspaces;
      const g = await Promise.all(
        all.map(x => getGhlConnection(token, x.id).catch(() => null)),
      );
      const next: Record<string, { status: string; connected: boolean; maskToken?: string } | null> = {};
      all.forEach((x, i) => {
        const c = g[i];
        next[x.id] = c ? { status: c.status, connected: c.connected, maskToken: c.maskToken } : null;
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

  // Best-effort load of agency-configured default credits used to prefill the create modal.
  // Failure here must not block opening or submitting the modal — fall back to FALLBACK_INITIAL_CREDITS.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getQuotaAgencySettings(token);
        if (cancelled) return;
        const n = Number(s?.defaultSubaccountQuota);
        if (Number.isFinite(n) && n > 0) {
          setAgencyDefaultCredits(Math.floor(n));
        }
      } catch {
        // Intentionally swallow: keep fallback so the modal still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(t => t.name.toLowerCase().includes(s));
  }, [list, q]);

  const openCreateModal = () => {
    setErr('');
    setCreateErr('');
    setCreateOk('');
    setNewName('');
    setNewGhlLocationId('');
    setNewAnnualMonths(12);
    setNewInitialCredits(String(agencyDefaultCredits));
    setNewClientName('');
    setNewClientPhone('');
    setNewClientEmail('');
    setCreateModalOpen(true);
  };

  const onCreate = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!token || !user?.agencyId || !newName.trim()) return;
    const credits = parseInt(newInitialCredits, 10);
    if (!Number.isFinite(credits) || credits < 0) {
      setCreateErr('Initial credits must be a non-negative whole number.');
      return;
    }
    setCreating(true);
    setCreateErr('');
    setCreateOk('');
    try {
      const g = newGhlLocationId.trim();
      const created = await createSubaccount(token, {
        agencyId: user.agencyId,
        name: newName.trim(),
        ...(g ? { ghlLocationId: g } : {}),
        annualPlanDurationMonths: newAnnualMonths,
        initialCredits: credits,
        clientContactName: newClientName.trim() || null,
        clientContactPhone: newClientPhone.trim() || null,
        clientContactEmail: newClientEmail.trim() || null,
      });
      setCreateOk(`Workspace created: ${created.name}`);
      setCreateModalOpen(false);
      setLoadAttempt(a => a + 1);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const openDeleteModal = (row: TenantRow) => {
    if (row.isAgencyWorkspace) return;
    setErr('');
    setDeleteOk('');
    setDeleteClientAcknowledged(false);
    setDeletePhraseInput('');
    setDeleteConfirm(row);
  };

  const deleteFormValid = deleteClientAcknowledged && deletePhraseInput === 'delete';

  const onConfirmDelete = async () => {
    if (!token || !deleteConfirm || !deleteFormValid) return;
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
      setDeleteClientAcknowledged(false);
      setDeletePhraseInput('');
      setDeleteOk('Workspace removed.');
      setLoadAttempt(a => a + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const onEnsureSystemWorkspace = async () => {
    if (!token || !user?.agencyId) return;
    setEnsuringSystem(true);
    setErr('');
    try {
      await ensureAgencySystemWorkspace(token, user.agencyId);
      setLoadAttempt(a => a + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to set up agency workspace');
    } finally {
      setEnsuringSystem(false);
    }
  };

  const workspaceToolbar = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.65rem',
        alignItems: 'center',
        marginBottom: '1rem',
      }}
    >
      <input
        type="search"
        placeholder="Search by name"
        value={q}
        onChange={e => setQ(e.target.value)}
        aria-label="Search workspaces"
        style={{ ...mvpInputStyle, flex: '1 1 220px', minWidth: '200px', marginTop: 0 }}
      />
      <button type="button" onClick={openCreateModal} style={mvpPrimaryButtonStyle}>
        Create workspace
      </button>
    </div>
  );

  const agencyWorkspaceCard = (
    <SectionCard
      title="Agency workspace"
      subtitle="Used for internal notifications and agency-owned CRM sending. Cannot be deleted."
    >
      {systemWorkspace ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.85rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)', fontSize: '1rem' }}>
              {systemWorkspace.name}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
              Unlimited credits · Used to send automated low-credit warnings to client workspaces.
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
            {ghlById[systemWorkspace.id] ? (
              <StatusPill
                label={
                  ghlById[systemWorkspace.id]?.connected && ghlById[systemWorkspace.id]?.status === 'CONNECTED'
                    ? 'CRM connected'
                    : ghlById[systemWorkspace.id]?.status === 'DISCONNECTED'
                      ? 'CRM not connected'
                      : 'CRM needs review'
                }
                tone={
                  ghlById[systemWorkspace.id]?.connected && ghlById[systemWorkspace.id]?.status === 'CONNECTED'
                    ? 'ok'
                    : ghlById[systemWorkspace.id]?.status === 'DISCONNECTED'
                      ? 'warn'
                      : 'bad'
                }
              />
            ) : (
              <StatusPill label="CRM not connected" tone="warn" />
            )}
            <Link
              href={`/app/agency/settings/ghl?subaccount=${encodeURIComponent(systemWorkspace.id)}`}
              style={{
                display: 'inline-block',
                padding: '0.35rem 0.65rem',
                borderRadius: 6,
                border: '1px solid var(--aisbp-border-strong, #cbd5e1)',
                color: 'var(--aisbp-text-secondary, #1a1a1a)',
                background: 'var(--aisbp-surface, #fff)',
                textDecoration: 'none',
                fontSize: '0.82rem',
                fontWeight: 600,
              }}
            >
              Configure CRM
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <p style={{ margin: 0, color: 'var(--aisbp-muted, #64748b)', fontSize: '0.86rem', lineHeight: 1.5 }}>
            Each agency has one internal workspace used to send low-credit warnings on behalf of the agency.
            It does not appear in client workspace credit totals.
          </p>
          <p style={{ margin: 0, color: 'var(--aisbp-muted, #64748b)', fontSize: '0.82rem', lineHeight: 1.5 }}>
            Low-credit warning SMS cannot be sent until the agency workspace is set up and connected to CRM.
          </p>
          <button
            type="button"
            onClick={onEnsureSystemWorkspace}
            disabled={ensuringSystem}
            style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: ensuringSystem ? 0.7 : 1 }}
          >
            {ensuringSystem ? 'Setting up…' : 'Set up agency workspace'}
          </button>
        </div>
      )}
    </SectionCard>
  );

  return (
    <div>
      <PageHeader title="Client Workspaces" eyebrow="Agency account" />
      {deleteOk ? (
        <p
          style={{
            fontSize: '0.86rem',
            color: 'var(--aisbp-alert-success-fg, #166534)',
            margin: '0 0 0.75rem',
            fontWeight: 600,
          }}
        >
          {deleteOk}
        </p>
      ) : null}
      <p
        style={{
          fontSize: '0.83rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 0.75rem',
          lineHeight: 1.45,
          maxWidth: '40rem',
        }}
      >
        Create and manage the client workspaces connected to CRM.
      </p>

      {createOk ? (
        <p
          style={{
            fontSize: '0.86rem',
            color: 'var(--aisbp-alert-success-fg, #166534)',
            margin: '0 0 0.75rem',
            fontWeight: 600,
          }}
        >
          {createOk}
        </p>
      ) : null}

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
              ...mvpButtonStyle,
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock message="Loading…" />
      ) : (
        <>
          {agencyWorkspaceCard}

          {err && list.length === 0 ? null : list.length === 0 ? (
            <SectionCard title="Client workspaces" subtitle="Create a client workspace to get started.">
              <EmptyState
                title="No client workspaces yet"
                detail="Add a workspace, then connect CRM from the workspace or CRM Connection settings."
              />
              <button type="button" onClick={openCreateModal} style={{ ...mvpPrimaryButtonStyle, marginTop: '0.85rem' }}>
                Create workspace
              </button>
            </SectionCard>
          ) : (
            <SectionCard
              title={`Client workspaces (${filtered.length}${filtered.length !== list.length ? ` of ${list.length}` : ''})`}
              subtitle="Search by name, then open or configure a workspace."
            >
              {workspaceToolbar}
              {filtered.length === 0 ? (
                <EmptyState title="No matches" detail="Try a different search term." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '920px' }}>
                    <thead>
                      <tr
                        style={{
                          textAlign: 'left',
                          borderBottom: '1px solid var(--aisbp-border, #e5e5e5)',
                        }}
                      >
                        {(['Workspace', 'Status', 'CRM Connection', 'AI setup', 'Actions'] as const).map(h => (
                          <th
                            key={h}
                            style={{
                              padding: '0.6rem 0.5rem',
                              fontWeight: 600,
                              color: 'var(--aisbp-text-secondary, #444)',
                            }}
                          >
                            {h}
                          </th>
                        ))}
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
        </>
      )}

      {createModalOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--aisbp-overlay, rgba(15, 23, 42, 0.45))',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-workspace-title"
        >
          <div
            style={{
              background: 'var(--aisbp-modal-bg, #fff)',
              border: '1px solid var(--aisbp-modal-border, #e2e8f0)',
              borderRadius: '10px',
              padding: '1.25rem 1.35rem',
              maxWidth: '520px',
              width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <h2
              id="create-workspace-title"
              style={{
                fontSize: '1.05rem',
                fontWeight: 800,
                margin: '0 0 0.5rem',
                color: 'var(--aisbp-text-heading, #0f172a)',
              }}
            >
              Create workspace
            </h2>
            <p
              style={{
                fontSize: '0.86rem',
                color: 'var(--aisbp-muted, #475569)',
                lineHeight: 1.5,
                margin: '0 0 1rem',
              }}
            >
              Set the annual plan and initial credits. CRM and client contact details can be filled in now or later.
            </p>
            <form onSubmit={onCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <label style={mvpLabelStyle}>
                Workspace name
                <input
                  value={newName}
                  onChange={e => {
                    setNewName(e.target.value);
                    setCreateErr('');
                  }}
                  placeholder="e.g. Acme Dental"
                  style={mvpInputStyle}
                  autoComplete="off"
                  aria-label="Workspace name"
                  autoFocus
                />
              </label>
              <label style={mvpLabelStyle}>
                CRM location ID (optional)
                <input
                  value={newGhlLocationId}
                  onChange={e => {
                    setNewGhlLocationId(e.target.value);
                    setCreateErr('');
                  }}
                  placeholder="From CRM location settings"
                  style={mvpInputStyle}
                  autoComplete="off"
                  aria-label="Optional CRM location ID"
                />
                <span style={mvpFieldHint}>You can add or change this later in CRM Connection settings.</span>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label style={mvpLabelStyle}>
                  Annual plan
                  <select
                    value={newAnnualMonths}
                    onChange={e => setNewAnnualMonths(parseInt(e.target.value, 10) || 12)}
                    style={mvpInputStyle}
                  >
                    {ANNUAL_PLAN_OPTIONS.map(o => (
                      <option key={o.months} value={o.months}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span style={mvpFieldHint}>Sets the next reset date one year from today.</span>
                </label>
                <label style={mvpLabelStyle}>
                  Initial credits
                  <input
                    value={newInitialCredits}
                    onChange={e => setNewInitialCredits(e.target.value)}
                    type="number"
                    min={0}
                    style={mvpInputStyle}
                  />
                  <span style={mvpFieldHint}>
                    {`Default: ${agencyDefaultCredits.toLocaleString()} (from agency credit settings).`}
                  </span>
                </label>
              </div>

              <p
                style={{
                  margin: '0.25rem 0 0',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--aisbp-muted, #64748b)',
                }}
              >
                Client contact (optional)
              </p>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.45 }}>
                Used to send automated low-credit warnings. You can add or change these later from the workspace.
              </p>
              <label style={mvpLabelStyle}>
                Client contact name
                <input
                  value={newClientName}
                  onChange={e => setNewClientName(e.target.value)}
                  style={mvpInputStyle}
                  placeholder="Optional"
                  autoComplete="off"
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label style={mvpLabelStyle}>
                  Client phone number
                  <input
                    value={newClientPhone}
                    onChange={e => setNewClientPhone(e.target.value)}
                    style={mvpInputStyle}
                    placeholder="Optional"
                    autoComplete="off"
                  />
                </label>
                <label style={mvpLabelStyle}>
                  Client email
                  <input
                    value={newClientEmail}
                    onChange={e => setNewClientEmail(e.target.value)}
                    type="email"
                    style={mvpInputStyle}
                    placeholder="Optional"
                    autoComplete="off"
                  />
                </label>
              </div>

              {createErr ? <ErrorBanner message={createErr} /> : null}
              <div
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  marginTop: '0.25rem',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!creating) {
                      setCreateModalOpen(false);
                      setCreateErr('');
                    }
                  }}
                  disabled={creating}
                  style={mvpButtonStyle}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  style={{
                    ...mvpPrimaryButtonStyle,
                    opacity: creating || !newName.trim() ? 0.65 : 1,
                  }}
                >
                  {creating ? 'Creating…' : 'Create workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteConfirm ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--aisbp-overlay, rgba(15, 23, 42, 0.45))',
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
              background: 'var(--aisbp-modal-bg, #fff)',
              border: '1px solid var(--aisbp-modal-border, #e2e8f0)',
              borderRadius: '10px',
              padding: '1.25rem 1.35rem',
              maxWidth: '440px',
              width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
            }}
          >
            <h2
              id="delete-subaccount-title"
              style={{
                fontSize: '1.05rem',
                fontWeight: 800,
                margin: '0 0 0.5rem',
                color: 'var(--aisbp-text-heading, #0f172a)',
              }}
            >
              Delete workspace?
            </h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-muted, #475569)', lineHeight: 1.5, margin: '0 0 1rem' }}>
              This will remove the workspace record and may stop the client&apos;s AISalesBot Pro service access. Only continue if the client has
              been informed and agreed to stop the service.
            </p>
            <form
              onSubmit={e => {
                e.preventDefault();
                if (!deleteFormValid || deletingId) return;
                void onConfirmDelete();
              }}
            >
              <label
                style={{
                  display: 'flex',
                  gap: '0.55rem',
                  alignItems: 'flex-start',
                  fontSize: '0.86rem',
                  color: 'var(--aisbp-text-secondary, #334155)',
                  lineHeight: 1.45,
                  marginBottom: '1rem',
                  cursor: deletingId ? 'not-allowed' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={deleteClientAcknowledged}
                  disabled={deletingId !== null}
                  onChange={e => setDeleteClientAcknowledged(e.target.checked)}
                  style={{ marginTop: '0.2rem', flexShrink: 0 }}
                />
                <span>I confirm this client has been informed and agreed to stop the service.</span>
              </label>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 650,
                  color: 'var(--aisbp-text-secondary, #475569)',
                  marginBottom: '0.35rem',
                }}
              >
                Type &quot;delete&quot; to confirm.
              </label>
              <input
                type="text"
                value={deletePhraseInput}
                onChange={e => setDeletePhraseInput(e.target.value)}
                disabled={deletingId !== null}
                autoComplete="off"
                aria-label='Type "delete" to confirm'
                style={{ ...mvpInputStyle, marginBottom: '1.1rem' }}
              />
              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!deletingId) {
                      setDeleteConfirm(null);
                      setDeleteClientAcknowledged(false);
                      setDeletePhraseInput('');
                    }
                  }}
                  disabled={deletingId !== null}
                  style={mvpButtonStyle}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deletingId !== null || !deleteFormValid}
                  style={{
                    padding: '0.45rem 0.9rem',
                    fontSize: '0.86rem',
                    borderRadius: '6px',
                    border: '1px solid #b91c1c',
                    background: deleteFormValid ? '#b91c1c' : 'var(--aisbp-progress-track, #e2e8f0)',
                    color: deleteFormValid ? '#fff' : 'var(--aisbp-muted, #94a3b8)',
                    fontWeight: 700,
                    cursor: deletingId || !deleteFormValid ? 'not-allowed' : 'pointer',
                  }}
                >
                  {deletingId ? 'Deleting…' : 'Delete workspace'}
                </button>
              </div>
            </form>
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
  return (
    <tr
      style={{
        borderBottom: '1px solid var(--aisbp-border, #f1f5f9)',
        verticalAlign: 'top',
        background: 'var(--aisbp-table-row-bg, #fff)',
      }}
    >
      <td style={{ padding: '0.75rem 0.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-start' }}>
          <span style={{ fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)', fontSize: '0.95rem' }}>{t.name}</span>
          <Link
            href={`/app/tenant/${t.id}/control-panel`}
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--aisbp-tenant-nav-active-text, #2563eb)',
              textDecoration: 'none',
            }}
          >
            Open workspace settings →
          </Link>
        </div>
      </td>
      <td style={{ padding: '0.75rem 0.5rem' }}>
        <StatusPill label={t.status === 'ACTIVE' ? 'Active' : t.status} tone="neutral" />
      </td>
      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.8rem' }}>
        {ghl ? (
          <StatusPill
            label={
              ghl.connected && ghl.status === 'CONNECTED' ? 'Connected' : ghl.status === 'DISCONNECTED' ? 'Needs setup' : 'Needs review'
            }
            tone={ghl.connected && ghl.status === 'CONNECTED' ? 'ok' : ghl.status === 'DISCONNECTED' ? 'warn' : 'bad'}
          />
        ) : (
          <StatusPill label="Needs setup" tone="warn" />
        )}
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
              background: '#2563eb',
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
              border: '1px solid var(--aisbp-border-strong, #cbd5e1)',
              color: 'var(--aisbp-text-secondary, #1a1a1a)',
              background: 'var(--aisbp-surface, #fff)',
              textDecoration: 'none',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            Connect CRM
          </Link>
          <button
            type="button"
            onClick={() => onRequestDelete(t)}
            style={{
              display: 'inline-block',
              padding: '0.3rem 0.5rem',
              borderRadius: '6px',
              border: 'none',
              background: 'transparent',
              color: 'var(--aisbp-pill-bad-fg, #b91c1c)',
              fontSize: '0.78rem',
              fontWeight: 500,
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
            }}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
