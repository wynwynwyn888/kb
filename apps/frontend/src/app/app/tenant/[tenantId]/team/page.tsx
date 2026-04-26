'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  addTenantMember,
  getTenantById,
  listTenantUsers,
  provisionWorkspaceMemberCredentials,
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

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    ADMIN: 'Admin',
    AGENT: 'Agent',
    VIEWER: 'Viewer',
  };
  return labels[role] ?? role;
}

type Row = {
  id: string;
  role: string;
  profileId: string | null;
  email?: string | null;
  fullName?: string | null;
};

function isTenantAdminForTenant(
  tenantId: string,
  user: { tenantId?: string; tenantRole?: string } | null,
): boolean {
  return user?.tenantId === tenantId && user?.tenantRole === 'ADMIN';
}

function isAgencyStaffForTenant(
  user: { agencyId?: string } | null,
  tenantAgencyId: string | null,
): boolean {
  return Boolean(user?.agencyId && tenantAgencyId && user.agencyId === tenantAgencyId);
}

function canManageTeamRoster(
  tenantId: string,
  user: { tenantId?: string; tenantRole?: string; agencyId?: string } | null,
  tenantAgencyId: string | null,
): boolean {
  return isTenantAdminForTenant(tenantId, user) || isAgencyStaffForTenant(user, tenantAgencyId);
}

const thStyle = { padding: '0.65rem 0.6rem', fontWeight: 600, color: '#334155', fontSize: '0.82rem' };
const tdStyle = { padding: '0.75rem 0.6rem', verticalAlign: 'top' as const };

export default function TenantTeamPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();

  const [loadKey, setLoadKey] = useState(0);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantAgencyId, setTenantAgencyId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, TenantRoleValue>>({});
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newProfileId, setNewProfileId] = useState('');
  const [newRole, setNewRole] = useState<TenantRoleValue>('AGENT');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginFullName, setLoginFullName] = useState('');
  const [loginRole, setLoginRole] = useState<TenantRoleValue>('AGENT');
  const [provisioning, setProvisioning] = useState(false);

  const canManageTeam = canManageTeamRoster(tenantId, user, tenantAgencyId);
  const canAddByProfileId = isTenantAdminForTenant(tenantId, user);

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await getTenantById(token, tenantId);
        if (!cancelled) {
          setTenantName(t?.name ?? null);
          setTenantAgencyId(t?.agencyId ?? null);
        }
      } catch {
        if (!cancelled) {
          setTenantName(null);
          setTenantAgencyId(null);
        }
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
        `Remove ${label} from this workspace? They lose access here until re-added.`,
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

  const onProvisionLogin = async () => {
    if (!token || !loginEmail.trim() || !loginPassword) return;
    setErr('');
    setOk('');
    setProvisioning(true);
    try {
      await provisionWorkspaceMemberCredentials(token, {
        tenantId,
        email: loginEmail.trim(),
        password: loginPassword,
        fullName: loginFullName.trim() || undefined,
        role: loginRole,
      });
      setOk('Sign-in saved. They can use this email and password on the app login page.');
      setLoginPassword('');
      setLoadKey(k => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save sign-in');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div>
      {user?.agencyRole && (
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <Link href="/app/agency/tenants">← Client Workspaces</Link>
        </p>
      )}
      <PageHeader title="Workspace Team" eyebrow={tenantName ?? 'Client workspace'} />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 0.85rem', lineHeight: 1.5, maxWidth: '640px' }}>
        Manage who can access this client workspace. Workspace admins and your agency team can invite people and reset
        passwords.
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
          Your role: <strong>{roleLabel(user?.tenantRole ?? '—')}</strong>
        </span>
        {user?.tenantId && user.tenantId !== tenantId && !isAgencyStaffForTenant(user, tenantAgencyId) ? (
          <span style={{ color: '#b91c1c' }}>This is not your assigned workspace; team changes are disabled.</span>
        ) : null}
      </div>

      {err && <ErrorBanner message={err} />}
      {ok && <SuccessBanner message={ok} />}

      {canManageTeam ? (
        <SectionCard
          title="Client sign-in (email & password)"
          subtitle="Creates a Supabase Auth account (or resets the password) and attaches this workspace. Share credentials securely; anyone with them can sign in at /login."
          accent="default"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '440px' }}>
            <label style={mvpLabelStyle}>
              Email (sign-in)
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                autoComplete="off"
                disabled={provisioning}
                style={mvpInputStyle}
              />
            </label>
            <label style={mvpLabelStyle}>
              New password
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                autoComplete="new-password"
                disabled={provisioning}
                placeholder="At least 8 characters"
                style={mvpInputStyle}
              />
            </label>
            <label style={mvpLabelStyle}>
              Display name (optional)
              <input
                type="text"
                value={loginFullName}
                onChange={e => setLoginFullName(e.target.value)}
                disabled={provisioning}
                style={mvpInputStyle}
              />
            </label>
            <label style={mvpLabelStyle}>
              Workspace role
              <select
                value={loginRole}
                onChange={e => setLoginRole(e.target.value as TenantRoleValue)}
                disabled={provisioning}
                style={mvpSelectStyle}
              >
                {TENANT_ROLES.map(r => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void onProvisionLogin()}
              disabled={provisioning || !loginEmail.trim() || loginPassword.length < 8}
              style={{
                ...mvpPrimaryButtonStyle,
                width: 'fit-content',
                opacity: provisioning || !loginEmail.trim() || loginPassword.length < 8 ? 0.65 : 1,
              }}
            >
              {provisioning ? 'Saving…' : 'Save sign-in & access'}
            </button>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
              If this email already belongs to someone in the workspace, only their password is updated.
            </p>
          </div>
        </SectionCard>
      ) : null}

      {loading ? (
        <LoadingBlock message="Loading team…" />
      ) : (
        <SectionCard title={`People (${rows.length})`} subtitle="Everyone with access to this workspace.">
          {rows.length === 0 ? (
            <EmptyState
              title="No members yet"
              detail="Create a client login below, or add someone by user ID if your workspace admin prefers the advanced path."
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '560px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Role</th>
                    {canManageTeam ? <th style={thStyle}>Actions</th> : null}
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
                        <td style={tdStyle}>
                          {m.fullName?.trim() ? m.fullName : '—'}
                          <details style={{ marginTop: '0.35rem' }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: '#94a3b8' }}>Support details</summary>
                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', fontFamily: 'inherit', color: '#64748b', wordBreak: 'break-all' }}>
                              User ID: {m.profileId ?? '—'}
                            </p>
                          </details>
                        </td>
                        <td style={tdStyle}>
                          {canManageTeam ? (
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
                                  {roleLabel(r)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <StatusPill label={roleLabel(m.role)} tone="neutral" />
                          )}
                        </td>
                        {canManageTeam ? (
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

      {canAddByProfileId && (
        <SectionCard title="Add user" subtitle="Advanced setup for support-assisted workspace access." accent="muted">
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>
              Add by user ID (advanced)
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '480px', marginTop: '0.85rem' }}>
              <label style={mvpLabelStyle}>
                User ID
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
                      {roleLabel(r)}
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
                {adding ? 'Adding…' : 'Add user'}
              </button>
            </div>
          </details>
        </SectionCard>
      )}

      {!canManageTeam && (
        <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '0.75rem' }}>
          Workspace ID: <code style={{ fontSize: '0.75rem' }}>{tenantId}</code>
        </p>
      )}
    </div>
  );
}
