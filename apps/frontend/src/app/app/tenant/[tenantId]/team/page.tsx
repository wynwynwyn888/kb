'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  addTenantMember,
  createWorkspaceInviteLink,
  createWorkspaceMemberPasswordResetLink,
  getTenantById,
  listTenantUsers,
  listWorkspaceInvites,
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
  mvpSecondaryButtonStyle,
  mvpSelectStyle,
  mvpFieldHint,
} from '@/components/app/mvp-ui';

const TENANT_ROLES: TenantRoleValue[] = ['ADMIN', 'AGENT', 'VIEWER'];

function displayWorkspaceRole(role: string): string {
  if (role === 'ADMIN') return 'Admin';
  if (role === 'AGENT' || role === 'VIEWER') return 'User';
  return role;
}

type RoleSlot = 'admin' | 'user';

function memberToSlot(role: string): RoleSlot {
  return role === 'ADMIN' ? 'admin' : 'user';
}

function slotToTenantRole(slot: RoleSlot): TenantRoleValue {
  return slot === 'admin' ? 'ADMIN' : 'AGENT';
}

type Row = {
  id: string;
  role: string;
  profileId: string | null;
  email?: string | null;
  fullName?: string | null;
};

type PendingInvite = {
  id: string;
  email_original: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
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

function isPlausibleEmail(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  const at = s.indexOf('@');
  if (at <= 0 || at === s.length - 1) return false;
  const domain = s.slice(at + 1);
  return domain.includes('.') && domain.length >= 3;
}

async function copyText(label: string, text: string, onOk: (m: string) => void, onErr: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onOk(`${label} copied to clipboard.`);
  } catch {
    onErr('Could not copy automatically — select and copy the link manually.');
  }
}

export default function TenantTeamPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();

  const [loadKey, setLoadKey] = useState(0);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantAgencyId, setTenantAgencyId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, TenantRoleValue>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newProfileId, setNewProfileId] = useState('');
  const [newRole, setNewRole] = useState<TenantRoleValue>('AGENT');
  const [adding, setAdding] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleUi, setInviteRoleUi] = useState<'ADMIN' | 'USER'>('USER');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const [inviteEmailErr, setInviteEmailErr] = useState('');
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [resetLink, setResetLink] = useState<string | null>(null);

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
      const [r, inv] = await Promise.all([
        listTenantUsers(token, tenantId),
        listWorkspaceInvites(token, tenantId).catch(() => [] as PendingInvite[]),
      ]);
      setRows(r as Row[]);
      const drafts: Record<string, TenantRoleValue> = {};
      for (const m of r) {
        const role = m.role as TenantRoleValue;
        if (TENANT_ROLES.includes(role)) {
          drafts[m.id] = role === 'VIEWER' ? 'AGENT' : role;
        }
      }
      setRoleDrafts(drafts);
      setPendingInvites(inv.filter(i => i.status === 'PENDING'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch, loadKey]);

  // Clear sensitive single-use links from React state when the page unmounts
  // so they don't linger in DOM if the user navigates back to a cached view.
  useEffect(() => {
    return () => {
      setInviteLink(null);
      setResetLink(null);
    };
  }, []);

  const onCreateInvite = async () => {
    if (!token) return;
    const em = inviteEmail.trim();
    if (!em) {
      setInviteEmailErr('Enter an email address.');
      return;
    }
    if (!isPlausibleEmail(em)) {
      setInviteEmailErr('Enter a valid email address.');
      return;
    }
    setInviteEmailErr('');
    setErr('');
    setOk('');
    setResetLink(null);
    setInviteBusy(true);
    try {
      const r = await createWorkspaceInviteLink(token, {
        tenantId,
        email: em,
        role: inviteRoleUi === 'ADMIN' ? 'ADMIN' : 'USER',
      });
      setInviteLink({ email: em, url: r.actionLink });
      setOk(`Invite link created for ${em}.`);
      setInviteEmail('');
      setLoadKey(k => k + 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not create invite';
      if (/already has access|409/i.test(msg)) {
        setInviteEmailErr('This user already has access.');
      } else {
        setErr(msg);
      }
    } finally {
      setInviteBusy(false);
    }
  };

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

  const onSaveRole = async (membershipId: string, currentRole: string) => {
    if (!token) return;
    const next = roleDrafts[membershipId];
    if (!next || next === currentRole) return;
    setErr('');
    setOk('');
    setBusyId(membershipId);
    try {
      await updateTenantMemberRole(token, membershipId, next);
      setOk('Role updated.');
      setEditingId(null);
      setLoadKey(k => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  const onResetPassword = async (m: Row) => {
    if (!token) return;
    setErr('');
    setOk('');
    setResetLink(null);
    setInviteLink(null);
    setBusyId(m.id);
    try {
      const r = await createWorkspaceMemberPasswordResetLink(token, { tenantId, membershipId: m.id });
      setResetLink(r.actionLink);
      setOk('Reset link created. Send this link to the user so they can set a new password.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create reset link');
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = async (m: Row) => {
    if (!token) return;
    const label = m.email?.trim() || m.fullName?.trim() || m.profileId || m.id;
    if (!confirm(`Remove ${label} from this workspace? They lose access here until invited again.`)) {
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
          <Link href="/app/agency/tenants">← Workspaces</Link>
        </p>
      )}
      <PageHeader title="Workspace team" eyebrow={tenantName ?? 'Workspace'} />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 0.85rem', lineHeight: 1.5, maxWidth: '640px' }}>
        Manage who can access this workspace. Workspace admins and your agency team can send invite links and password reset
        links.
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
          Your role: <strong>{displayWorkspaceRole(user?.tenantRole ?? '—')}</strong>
        </span>
        {user?.tenantId && user.tenantId !== tenantId && !isAgencyStaffForTenant(user, tenantAgencyId) ? (
          <span style={{ color: '#b91c1c' }}>This is not your assigned workspace; team changes are disabled.</span>
        ) : null}
      </div>

      {err && <ErrorBanner message={err} />}
      {ok && <SuccessBanner message={ok} />}

      {canManageTeam ? (
        <SectionCard
          title="Invite workspace user"
          subtitle="Invite someone to access this workspace. They will use the invite link to set up their password."
        >
          {inviteLink ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '560px' }}>
              <SuccessBanner message="Invite link created." />
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#334155' }}>For {inviteLink.email}</p>
              <p
                role="note"
                style={{
                  margin: 0,
                  fontSize: '0.8rem',
                  color: '#92400e',
                  background: '#fef3c7',
                  border: '1px solid #fde68a',
                  padding: '0.5rem 0.65rem',
                  borderRadius: 6,
                  lineHeight: 1.45,
                }}
              >
                Treat this link like a password. Anyone with the link can access or reset the account.
              </p>
              <input readOnly value={inviteLink.url} style={{ ...mvpInputStyle, width: '100%', fontSize: '0.78rem' }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => void copyText('Invite link', inviteLink.url, m => setOk(m), m => setErr(m))}
                  style={{ ...mvpPrimaryButtonStyle, width: 'fit-content' }}
                >
                  Copy invite link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInviteLink(null);
                    setOk('');
                  }}
                  style={{ ...mvpSecondaryButtonStyle, width: 'fit-content' }}
                >
                  Create another invite
                </button>
              </div>
              <p style={{ ...mvpFieldHint, marginBottom: 0 }}>
                Send this link to the user so they can set up their account. The app does not send invite email automatically
                yet.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '480px' }}>
              <label style={mvpLabelStyle}>
                Email
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => {
                    setInviteEmail(e.target.value);
                    setInviteEmailErr('');
                  }}
                  disabled={inviteBusy}
                  autoComplete="off"
                  style={{
                    ...mvpInputStyle,
                    ...(inviteEmailErr ? { borderColor: '#f87171', boxShadow: '0 0 0 1px rgba(248, 113, 113, 0.35)' } : {}),
                  }}
                />
              </label>
              {inviteEmailErr ? (
                <p role="alert" style={{ fontSize: '0.8rem', color: '#b91c1c', margin: '-0.35rem 0 0' }}>
                  {inviteEmailErr}
                </p>
              ) : null}
              <label style={mvpLabelStyle}>
                Role
                <select
                  value={inviteRoleUi}
                  onChange={e => setInviteRoleUi(e.target.value as 'ADMIN' | 'USER')}
                  disabled={inviteBusy}
                  style={mvpSelectStyle}
                >
                  <option value="USER">User</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => void onCreateInvite()}
                disabled={inviteBusy || !inviteEmail.trim()}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: inviteBusy || !inviteEmail.trim() ? 0.65 : 1 }}
              >
                {inviteBusy ? 'Creating…' : 'Create invite link'}
              </button>
            </div>
          )}
        </SectionCard>
      ) : null}

      {resetLink ? (
        <SectionCard title="Copy reset link" subtitle="No email was sent from the app for this action.">
          <p
            role="note"
            style={{
              margin: '0 0 0.6rem',
              fontSize: '0.8rem',
              color: '#92400e',
              background: '#fef3c7',
              border: '1px solid #fde68a',
              padding: '0.5rem 0.65rem',
              borderRadius: 6,
              lineHeight: 1.45,
            }}
          >
            Treat this link like a password. Anyone with the link can access or reset the account.
          </p>
          <input readOnly value={resetLink} style={{ ...mvpInputStyle, width: '100%', fontSize: '0.78rem' }} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void copyText('Reset link', resetLink, m => setOk(m), m => setErr(m))}
              style={{ ...mvpPrimaryButtonStyle, width: 'fit-content' }}
            >
              Copy reset link
            </button>
            <button
              type="button"
              onClick={() => {
                setResetLink(null);
                setOk('');
              }}
              style={{ ...mvpSecondaryButtonStyle, width: 'fit-content' }}
            >
              Done
            </button>
          </div>
        </SectionCard>
      ) : null}

      {canManageTeam && pendingInvites.length > 0 ? (
        <SectionCard title="Pending invites" subtitle="Outstanding workspace invitations.">
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', color: '#475569' }}>
            {pendingInvites.map(i => (
              <li key={i.id}>
                {i.email_original} — {displayWorkspaceRole(i.role)}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {loading ? (
        <LoadingBlock message="Loading team…" />
      ) : (
        <SectionCard title={`People (${rows.length})`} subtitle="Everyone with access to this workspace.">
          {rows.length === 0 ? (
            <EmptyState title="No members yet" detail="Use Invite workspace user above to add someone by email." />
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
                    const backendRole = m.role as TenantRoleValue;
                    const normalizedBackend = backendRole === 'VIEWER' ? 'AGENT' : backendRole;
                    const changed = draft !== normalizedBackend;
                    const busy = busyId === m.id;
                    const editing = editingId === m.id;
                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={tdStyle}>{m.email?.trim() ? m.email : '—'}</td>
                        <td style={tdStyle}>{m.fullName?.trim() ? m.fullName : '—'}</td>
                        <td style={tdStyle}>
                          {canManageTeam ? (
                            editing ? (
                              <select
                                value={memberToSlot(draft)}
                                onChange={e =>
                                  setRoleDrafts(d => ({
                                    ...d,
                                    [m.id]: slotToTenantRole(e.target.value as RoleSlot),
                                  }))
                                }
                                disabled={busy}
                                style={{ ...mvpSelectStyle, maxWidth: '140px', padding: '0.35rem 0.45rem' }}
                              >
                                <option value="admin">Admin</option>
                                <option value="user">User</option>
                              </select>
                            ) : (
                              <span style={{ fontSize: '0.88rem', fontWeight: 650 }}>{displayWorkspaceRole(m.role)}</span>
                            )
                          ) : (
                            <StatusPill label={displayWorkspaceRole(m.role)} tone="neutral" />
                          )}
                        </td>
                        {canManageTeam ? (
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
                              {editing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void onSaveRole(m.id, normalizedBackend)}
                                    disabled={busy || !changed}
                                    style={{
                                      ...mvpPrimaryButtonStyle,
                                      padding: '0.4rem 0.75rem',
                                      fontSize: '0.82rem',
                                      opacity: busy || !changed ? 0.65 : 1,
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(null);
                                      setRoleDrafts(d => ({
                                        ...d,
                                        [m.id]: (m.role === 'VIEWER' ? 'AGENT' : m.role) as TenantRoleValue,
                                      }));
                                    }}
                                    disabled={busy}
                                    style={{ ...mvpSecondaryButtonStyle, padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setEditingId(m.id)}
                                    disabled={busy}
                                    style={{ ...mvpSecondaryButtonStyle, padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void onResetPassword(m)}
                                    disabled={busy}
                                    style={{ ...mvpSecondaryButtonStyle, padding: '0.4rem 0.7rem', fontSize: '0.82rem' }}
                                  >
                                    {busy ? '…' : 'Reset password'}
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
                                </>
                              )}
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
        <SectionCard title="Advanced" subtitle="Support-only: attach an existing profile by user ID." accent="muted">
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>
              Add by user ID
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
                  <option value="ADMIN">Admin</option>
                  <option value="AGENT">User</option>
                  <option value="VIEWER">Viewer</option>
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
    </div>
  );
}
