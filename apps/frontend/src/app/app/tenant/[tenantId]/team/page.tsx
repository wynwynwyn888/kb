'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  addTenantMember,
  getTenantById,
  listTenantUsers,
  removeTenantMember,
  updateTenantMemberRole,
  type TenantRoleValue,
} from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  SuccessBanner,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpSelectStyle,
} from '@/components/app/mvp-ui';

const TENANT_ROLES: TenantRoleValue[] = ['ADMIN', 'AGENT', 'VIEWER'];

type Row = {
  id: string;
  role: string;
  profileId: string | null;
  email?: string | null;
  fullName?: string | null;
};

function canManageTenantRoster(
  tenantId: string,
  user: { tenantId?: string; tenantRole?: string } | null,
): boolean {
  return user?.tenantId === tenantId && user?.tenantRole === 'ADMIN';
}

const thStyle = { padding: '0.65rem 0.6rem', fontWeight: 600, color: '#334155', fontSize: '0.82rem' };
const tdStyle = { padding: '0.75rem 0.6rem', verticalAlign: 'top' as const };

export default function TenantTeamPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();

  const [loadKey, setLoadKey] = useState(0);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, TenantRoleValue>>({});
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newProfileId, setNewProfileId] = useState('');
  const [newRole, setNewRole] = useState<TenantRoleValue>('AGENT');

  const canManage = canManageTenantRoster(tenantId, user);

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await getTenantById(token, tenantId);
        if (!cancelled) setTenantName(t?.name ?? null);
      } catch {
        if (!cancelled) setTenantName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId]);

  const refetch = useCallback(async () => {
    if (!token || !tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await listTenantUsers(token, tenantId);
      setRows(r as Row[]);
      const drafts: Record<string, TenantRoleValue> = {};
      for (const m of r) {
        if (TENANT_ROLES.includes(m.role as TenantRoleValue)) {
          drafts[m.id] = m.role as TenantRoleValue;
        }
      }
      setRoleDrafts(drafts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch, loadKey]);

  const onAdd = async () => {
    if (!token || !newProfileId.trim()) return;
    setErr('');
    setOk('');
    setAdding(true);
    try {
      await addTenantMember(token, {
        tenantId,
        profileId: newProfileId.trim(),
        role: newRole,
      });
      setOk('Member added.');
      setNewProfileId('');
      setNewRole('AGENT');
      setLoadKey(k => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add member');
    } finally {
      setAdding(false);
    }
  };

  const onApplyRole = async (membershipId: string, currentRole: string) => {
    if (!token) return;
    const next = roleDrafts[membershipId];
    if (!next || next === currentRole) return;
    setErr('');
    setOk('');
    setBusyId(membershipId);
    try {
      await updateTenantMemberRole(token, membershipId, next);
      setOk('Role updated.');
      setLoadKey(k => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = async (m: Row) => {
    if (!token) return;
    const label = m.email?.trim() || m.fullName?.trim() || m.profileId || m.id;
    if (
      !confirm(
        `Remove ${label} from this subaccount? They lose access here until re-added.`,
      )
    ) {
      return;
    }
    setErr('');
    setOk('');
    setBusyId(m.id);
    try {
      await removeTenantMember(token, m.id);
      setOk('Member removed.');
      setLoadKey(k => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove member');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {user?.agencyRole && (
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <Link href="/app/agency/tenants">← Subaccounts</Link>
        </p>
      )}
      <PageHeader title="Team" eyebrow={tenantName ?? 'Your subaccount'} />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 0.85rem', lineHeight: 1.5, maxWidth: '640px' }}>
        Who can open this subaccount. Only <strong>ADMIN</strong> can change the roster.
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.65rem',
          alignItems: 'center',
          marginBottom: '1rem',
          fontSize: '0.82rem',
          color: '#64748b',
        }}
      >
        <span>
          Your role: <strong>{user?.tenantRole ?? '—'}</strong>
        </span>
        {user?.tenantId && user.tenantId !== tenantId ? (
          <span style={{ color: '#b91c1c' }}>This URL is not your assigned subaccount — roster changes are disabled.</span>
        ) : null}
      </div>

      {err && <ErrorBanner message={err} />}
      {ok && <SuccessBanner message={ok} />}

      {loading ? (
        <LoadingBlock message="Loading team…" />
      ) : (
        <SectionCard title={`People (${rows.length})`} subtitle="Everyone with access to this subaccount.">
          {rows.length === 0 ? (
            <EmptyState title="No members yet" detail="Invite teammates below when you have their profile UUID." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '560px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Profile ID</th>
                    <th style={thStyle}>Role</th>
                    {canManage ? <th style={thStyle}>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(m => {
                    const draft = roleDrafts[m.id] ?? (m.role as TenantRoleValue);
                    const changed = draft !== m.role;
                    const busy = busyId === m.id;
                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={tdStyle}>{m.email?.trim() ? m.email : '—'}</td>
                        <td style={tdStyle}>{m.fullName?.trim() ? m.fullName : '—'}</td>
                        <td style={{ ...tdStyle, fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace', color: '#64748b' }}>
                          {m.profileId ?? '—'}
                        </td>
                        <td style={tdStyle}>
                          {canManage ? (
                            <select
                              value={draft}
                              onChange={e =>
                                setRoleDrafts(d => ({
                                  ...d,
                                  [m.id]: e.target.value as TenantRoleValue,
                                }))
                              }
                              disabled={busy}
                              style={{ ...mvpSelectStyle, maxWidth: '140px', padding: '0.35rem 0.45rem' }}
                            >
                              {TENANT_ROLES.map(r => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <StatusPill label={m.role} tone="neutral" />
                          )}
                        </td>
                        {canManage ? (
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => void onApplyRole(m.id, m.role)}
                                disabled={busy || !changed}
                                style={{
                                  padding: '0.4rem 0.7rem',
                                  fontSize: '0.82rem',
                                  borderRadius: '6px',
                                  border: '1px solid #2563eb',
                                  background: changed ? '#2563eb' : '#e2e8f0',
                                  color: changed ? '#fff' : '#94a3b8',
                                  cursor: busy || !changed ? 'not-allowed' : 'pointer',
                                  fontWeight: 600,
                                }}
                              >
                                {busy ? '…' : 'Apply'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void onRemove(m)}
                                disabled={busy}
                                style={{
                                  padding: '0.4rem 0.7rem',
                                  fontSize: '0.82rem',
                                  borderRadius: '6px',
                                  border: '1px solid #fecaca',
                                  background: '#fff1f2',
                                  color: '#b91c1c',
                                  cursor: busy ? 'not-allowed' : 'pointer',
                                  opacity: busy ? 0.7 : 1,
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {canManage && (
        <SectionCard title="Invite someone" subtitle="Requires profile UUID from your user directory." accent="muted">
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>
              Add by profile UUID (advanced)
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '480px', marginTop: '0.85rem' }}>
              <label style={mvpLabelStyle}>
                Profile ID
                <input
                  value={newProfileId}
                  onChange={e => setNewProfileId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  disabled={adding}
                  autoComplete="off"
                  style={mvpInputStyle}
                />
              </label>
              <label style={mvpLabelStyle}>
                Role
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as TenantRoleValue)}
                  disabled={adding}
                  style={mvpSelectStyle}
                >
                  {TENANT_ROLES.map(r => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void onAdd()}
                disabled={adding || !newProfileId.trim()}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: adding || !newProfileId.trim() ? 0.7 : 1 }}
              >
                {adding ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </details>
        </SectionCard>
      )}

      {!canManage && (
        <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '0.75rem' }}>
          Subaccount id: <code style={{ fontSize: '0.75rem' }}>{tenantId}</code>
        </p>
      )}
    </div>
  );
}
