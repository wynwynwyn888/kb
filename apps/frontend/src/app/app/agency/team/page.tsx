'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  addAgencyMember,
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
  mvpSelectStyle,
} from '@/components/app/mvp-ui';

const AGENCY_ROLES: AgencyRoleValue[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER'];

type Row = {
  id: string;
  role: string;
  profileId: string | null;
  email?: string | null;
  fullName?: string | null;
};

function canManageAgencyRoster(user: { agencyRole?: string } | null): boolean {
  const r = user?.agencyRole;
  return r === 'OWNER' || r === 'ADMIN';
}

const thStyle = { padding: '0.65rem 0.6rem', fontWeight: 600, color: '#334155', fontSize: '0.82rem' };
const tdStyle = { padding: '0.75rem 0.6rem', verticalAlign: 'top' as const };

export default function AgencyTeamPage() {
  const { token, user } = useAuth();
  const [loadKey, setLoadKey] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AgencyRoleValue>>({});
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newProfileId, setNewProfileId] = useState('');
  const [newRole, setNewRole] = useState<AgencyRoleValue>('MEMBER');

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
      const r = await listAgencyUsers(token, agencyId);
      setRows(r as Row[]);
      const drafts: Record<string, AgencyRoleValue> = {};
      for (const m of r) {
        if (AGENCY_ROLES.includes(m.role as AgencyRoleValue)) {
          drafts[m.id] = m.role as AgencyRoleValue;
        }
      }
      setRoleDrafts(drafts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list members');
    } finally {
      setLoading(false);
    }
  }, [token, user?.agencyId]);

  useEffect(() => {
    void refetch();
  }, [refetch, loadKey]);

  const agencyId = user?.agencyId;

  const onAdd = async () => {
    if (!token || !agencyId) return;
    const em = newEmail.trim();
    const pid = newProfileId.trim();
    if (!em && !pid) {
      setErr('Enter a work email, or open Advanced if support gave you an internal id.');
      return;
    }
    if (em && pid) {
      setErr('Use work email or Advanced, not both.');
      return;
    }
    setErr('');
    setOk('');
    setAdding(true);
    try {
      await addAgencyMember(token, {
        agencyId,
        role: newRole,
        ...(em ? { email: em } : { profileId: pid }),
      });
      setOk('User added to the team.');
      setNewEmail('');
      setNewProfileId('');
      setNewRole('MEMBER');
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
      await updateAgencyMemberRole(token, membershipId, next);
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
        `Remove ${label} from this agency? They will lose agency access until re-added.`,
      )
    ) {
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
      <PageHeader title="Agency team" eyebrow="Agency account" />
      <p style={{ fontSize: '0.86rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: '44rem' }}>
        Everyone listed here can sign in to this agency. Add people by <strong>work email</strong> and <strong>role</strong>.
        The person must already have an account for that email. <strong>Advanced</strong> is for support-led setup only.
      </p>

      {err && <ErrorBanner message={err} />}
      {ok && <SuccessBanner message={ok} />}

      {!canManage && (
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
          Your role is <strong>{user?.agencyRole ?? '—'}</strong>. Only <strong>OWNER</strong> or <strong>ADMIN</strong>{' '}
          can change the roster.
        </p>
      )}

      {loading ? (
        <LoadingBlock message="Loading…" />
      ) : (
        <SectionCard
          title={`Team members (${rows.length})`}
          subtitle="People with access to this agency."
        >
          {rows.length === 0 ? (
            <EmptyState
              title="No team members yet"
              detail="Use work email and role in Add user below."
            />
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
                    const changed = draft !== m.role;
                    const busy = busyId === m.id;
                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={tdStyle}>{m.email?.trim() ? m.email : '—'}</td>
                        <td style={tdStyle}>{m.fullName?.trim() ? m.fullName : '—'}</td>
                        <td style={tdStyle}>
                          {canManage ? (
                            <select
                              value={draft}
                              onChange={e =>
                                setRoleDrafts(d => ({
                                  ...d,
                                  [m.id]: e.target.value as AgencyRoleValue,
                                }))
                              }
                              disabled={busy}
                              style={{ ...mvpSelectStyle, maxWidth: '150px', padding: '0.35rem 0.45rem' }}
                            >
                              {AGENCY_ROLES.map(r => (
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

      {canManage && agencyId && (
        <SectionCard title="Add user" subtitle="Work email, then role, then add.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '480px' }}>
            <label style={mvpLabelStyle}>
              Work email
              <input
                value={newEmail}
                onChange={e => {
                  setNewEmail(e.target.value);
                  setNewProfileId('');
                }}
                placeholder="name@company.com"
                disabled={adding}
                autoComplete="off"
                type="email"
                style={mvpInputStyle}
              />
            </label>
            <label style={mvpLabelStyle}>
              Role
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as AgencyRoleValue)}
                disabled={adding}
                style={mvpSelectStyle}
              >
                {AGENCY_ROLES.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={adding || !newEmail.trim()}
              style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: adding || !newEmail.trim() ? 0.7 : 1 }}
            >
              {adding ? 'Adding…' : 'Add user'}
            </button>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: '#64748b' }}>Advanced (support only)</summary>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.5rem 0' }}>
                Use this only when support provides an internal user id. Normal invites always use work email.
              </p>
              <label style={mvpLabelStyle}>
                Internal user id
                <input
                  value={newProfileId}
                  onChange={e => {
                    setNewProfileId(e.target.value);
                    setNewEmail('');
                  }}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  disabled={adding}
                  autoComplete="off"
                  style={mvpInputStyle}
                />
              </label>
              <button
                type="button"
                onClick={() => void onAdd()}
                disabled={adding || !newProfileId.trim() || Boolean(newEmail.trim())}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', marginTop: '0.5rem', opacity: adding || !newProfileId.trim() ? 0.7 : 1 }}
              >
                {adding ? 'Adding…' : 'Add by internal id'}
              </button>
            </details>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
