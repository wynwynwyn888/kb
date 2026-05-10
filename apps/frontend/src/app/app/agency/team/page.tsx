'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createAgencyInviteLink,
  createAgencyMemberPasswordResetLink,
  isApiHttpError,
  listAgencyInvites,
  listAgencyUsers,
  removeAgencyMember,
  updateAgencyMemberRole,
  type AgencyRoleValue,
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

const AGENCY_ROLES: AgencyRoleValue[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER'];

function rosterDisplayRole(role: string): string {
  if (role === 'OWNER') return 'Owner';
  if (role === 'ADMIN') return 'Admin';
  if (role === 'MEMBER' || role === 'OPERATOR') return 'User';
  return role;
}

type RoleSlot = 'admin' | 'user';

function draftToSlot(d: AgencyRoleValue): RoleSlot {
  return d === 'ADMIN' ? 'admin' : 'user';
}

function slotToDraft(slot: RoleSlot): AgencyRoleValue {
  return slot === 'admin' ? 'ADMIN' : 'MEMBER';
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

function canManageAgencyRoster(user: { agencyRole?: string } | null): boolean {
  const r = user?.agencyRole;
  return r === 'OWNER' || r === 'ADMIN';
}

function isPlausibleEmail(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (s.includes(' ') || s.includes('\n')) return false;
  const at = s.indexOf('@');
  if (at <= 0 || at === s.length - 1) return false;
  const domain = s.slice(at + 1);
  return domain.includes('.') && domain.length >= 3;
}

const thStyle = {
  padding: '0.65rem 0.6rem',
  fontWeight: 600,
  color: 'var(--aisbp-text-secondary, #334155)',
  fontSize: '0.82rem',
};
const tdStyle = { padding: '0.75rem 0.6rem', verticalAlign: 'top' as const };

async function copyText(label: string, text: string, onOk: (m: string) => void, onErr: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onOk(`${label} copied to clipboard.`);
  } catch {
    onErr('Could not copy automatically — select and copy the link manually.');
  }
}

export default function AgencyTeamPage() {
  const { token, user } = useAuth();
  const [loadKey, setLoadKey] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AgencyRoleValue>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'USER'>('USER');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const [inviteEmailErr, setInviteEmailErr] = useState('');
  const inviteEmailRef = useRef<HTMLInputElement>(null);

  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [resetLink, setResetLink] = useState<string | null>(null);

  const canManage = canManageAgencyRoster(user);

  const refetch = useCallback(async () => {
    const agencyId = user?.agencyId;
    if (!token || !agencyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const [r, inv] = await Promise.all([
        listAgencyUsers(token, agencyId),
        listAgencyInvites(token, agencyId).catch(() => [] as PendingInvite[]),
      ]);
      setRows(r as Row[]);
      const drafts: Record<string, AgencyRoleValue> = {};
      for (const m of r) {
        if (AGENCY_ROLES.includes(m.role as AgencyRoleValue)) {
          drafts[m.id] = m.role as AgencyRoleValue;
        }
      }
      setRoleDrafts(drafts);
      setPendingInvites(inv.filter(i => i.status === 'PENDING'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list members');
    } finally {
      setLoading(false);
    }
  }, [token, user?.agencyId]);

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

  const agencyId = user?.agencyId;

  const onCreateInvite = async () => {
    if (!token || !agencyId) return;
    const em = inviteEmail.trim();
    if (!em) {
      setInviteEmailErr('Enter an email address.');
      return;
    }
    const el = inviteEmailRef.current;
    if (el && typeof el.checkValidity === 'function' && !el.checkValidity()) {
      setInviteEmailErr(el.validationMessage || 'Enter a valid email address.');
      return;
    }
    if (!isPlausibleEmail(em)) {
      setInviteEmailErr('Enter a valid email address (for example, name@company.com).');
      return;
    }
    setInviteEmailErr('');
    setErr('');
    setOk('');
    setResetLink(null);
    setInviteBusy(true);
    try {
      const r = await createAgencyInviteLink(token, {
        agencyId,
        email: em,
        role: inviteRole === 'ADMIN' ? 'ADMIN' : 'USER',
      });
      setInviteLink({ email: em, url: r.actionLink });
      setOk(`Invite link created for ${em}.`);
      setInviteEmail('');
      setLoadKey(k => k + 1);
    } catch (e) {
      if (isApiHttpError(e)) {
        const m = e.message.toLowerCase();
        if (e.status === 409 || m.includes('already has access')) {
          setInviteEmailErr('This user already has access.');
        } else {
          setErr(e.message || 'Could not create invite.');
        }
      } else {
        setErr(e instanceof Error ? e.message : 'Could not create invite.');
      }
    } finally {
      setInviteBusy(false);
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
      await updateAgencyMemberRole(token, membershipId, next);
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
    if (!token || !agencyId) return;
    setErr('');
    setOk('');
    setResetLink(null);
    setInviteLink(null);
    setBusyId(m.id);
    try {
      const r = await createAgencyMemberPasswordResetLink(token, { agencyId, membershipId: m.id });
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
    if (!confirm(`Remove ${label} from this agency? They will lose agency access until invited again.`)) {
      return;
    }
    setErr('');
    setOk('');
    setBusyId(m.id);
    try {
      await removeAgencyMember(token, m.id);
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
      <PageHeader title="Team" eyebrow="Agency account" />
      <p
        style={{
          fontSize: '0.86rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 1rem',
          lineHeight: 1.5,
          maxWidth: '44rem',
        }}
      >
        Manage who can access this agency. New people join with an invite link so they can set their own password.
      </p>

      {err && <ErrorBanner message={err} />}
      {ok && <SuccessBanner message={ok} />}

      {!canManage && (
        <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', marginBottom: '1rem' }}>
          Your role is <strong>{rosterDisplayRole(user?.agencyRole ?? '—')}</strong>. Only owners or admins can change the team.
        </p>
      )}

      {loading ? (
        <LoadingBlock message="Loading…" />
      ) : (
        <SectionCard title={`Team members (${rows.length})`} subtitle="People with access to this agency.">
          {rows.length === 0 ? (
            <EmptyState title="No team members yet" detail="Use Invite team member below to add someone." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '520px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Role</th>
                    {canManage ? <th style={thStyle}>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(m => {
                    const draft = roleDrafts[m.id] ?? (m.role as AgencyRoleValue);
                    const isOwner = m.role === 'OWNER';
                    const changed = !isOwner && draft !== m.role;
                    const busy = busyId === m.id;
                    const editing = editingId === m.id;
                    return (
                      <tr
                        key={m.id}
                        style={{
                          borderBottom: '1px solid var(--aisbp-border, #f1f5f9)',
                          background: 'var(--aisbp-table-row-bg, #fff)',
                        }}
                      >
                        <td style={{ ...tdStyle, color: 'var(--aisbp-text, #0f172a)' }}>{m.email?.trim() ? m.email : '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--aisbp-text, #0f172a)' }}>{m.fullName?.trim() ? m.fullName : '—'}</td>
                        <td style={tdStyle}>
                          {canManage ? (
                            isOwner ? (
                              <div>
                                <span style={{ fontSize: '0.88rem', fontWeight: 650, color: 'var(--aisbp-text, #0f172a)' }}>
                                  Owner
                                </span>
                                <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: 'var(--aisbp-muted, #64748b)' }}>
                                  Owner role cannot be changed here.
                                </p>
                              </div>
                            ) : editing ? (
                              <select
                                value={draftToSlot(draft)}
                                onChange={e =>
                                  setRoleDrafts(d => ({
                                    ...d,
                                    [m.id]: slotToDraft(e.target.value as RoleSlot),
                                  }))
                                }
                                disabled={busy}
                                style={{ ...mvpSelectStyle, maxWidth: '160px', padding: '0.35rem 0.45rem' }}
                              >
                                <option value="admin">Admin</option>
                                <option value="user">User</option>
                              </select>
                            ) : (
                              <span style={{ fontSize: '0.88rem', fontWeight: 650 }}>{rosterDisplayRole(m.role)}</span>
                            )
                          ) : (
                            <StatusPill label={rosterDisplayRole(m.role)} tone="neutral" />
                          )}
                        </td>
                        {canManage ? (
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
                              {isOwner ? (
                                <button
                                  type="button"
                                  onClick={() => void onResetPassword(m)}
                                  disabled={busy}
                                  style={{ ...mvpSecondaryButtonStyle, padding: '0.4rem 0.7rem', fontSize: '0.82rem' }}
                                >
                                  {busy ? '…' : 'Reset password'}
                                </button>
                              ) : editing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void onSaveRole(m.id, m.role)}
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
                                      setRoleDrafts(d => ({ ...d, [m.id]: m.role as AgencyRoleValue }));
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
          <input readOnly value={resetLink} style={{ ...mvpInputStyle, width: '100%', maxWidth: '100%', fontSize: '0.78rem' }} />
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

      {canManage && agencyId && pendingInvites.length > 0 ? (
        <SectionCard title="Pending invites" subtitle="Links can be re-created from Invite team member if needed.">
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', color: 'var(--aisbp-text-secondary)' }}>
            {pendingInvites.map(i => (
              <li key={i.id}>
                {i.email_original} — {rosterDisplayRole(i.role)}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {canManage && agencyId && (
        <SectionCard
          title="Invite team member"
          subtitle="Invite someone to access this agency account. They will use the invite link to set up their password."
        >
          {inviteLink ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '560px' }}>
              <SuccessBanner message={`Invite link created for ${inviteLink.email}.`} />
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
              <input
                readOnly
                value={inviteLink.url}
                style={{ ...mvpInputStyle, width: '100%', fontSize: '0.78rem' }}
              />
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
                  ref={inviteEmailRef}
                  value={inviteEmail}
                  onChange={e => {
                    setInviteEmail(e.target.value);
                    setInviteEmailErr('');
                  }}
                  placeholder="name@company.com"
                  disabled={inviteBusy}
                  autoComplete="off"
                  type="email"
                  style={{
                    ...mvpInputStyle,
                    ...(inviteEmailErr ? { borderColor: '#f87171', boxShadow: '0 0 0 1px rgba(248, 113, 113, 0.35)' } : {}),
                  }}
                />
              </label>
              {inviteEmailErr ? (
                <p role="alert" style={{ fontSize: '0.8rem', color: '#b91c1c', margin: '-0.35rem 0 0', lineHeight: 1.45 }}>
                  {inviteEmailErr}
                </p>
              ) : null}
              <label style={mvpLabelStyle}>
                Role
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'ADMIN' | 'USER')}
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
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: inviteBusy || !inviteEmail.trim() ? 0.7 : 1 }}
              >
                {inviteBusy ? 'Creating…' : 'Create invite link'}
              </button>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
