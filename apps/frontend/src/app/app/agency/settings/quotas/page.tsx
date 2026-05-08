'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCurrentUser,
  getQuotaAgencySettings,
  getQuotaAuditLog,
  setAgencyDefaultQuota,
  topupSubaccountQuota,
  adjustSubaccountCredits,
  listAgencyCreditWallets,
  updateSubaccountCreditPolicy,
  type QuotaAuditLogRow,
} from '@/lib/api';
import { ErrorBanner, LoadingBlock, PageHeader, SectionCard, SuccessBanner } from '@/components/app/mvp-ui';
import { creditStatusLabel, formatSignedInt } from '@/lib/credits-ui';

export default function AgencyQuotasPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [defaultQuota, setDefaultQuota] = useState<number | null>(null);
  const [defaultInput, setDefaultInput] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);

  const [wallets, setWallets] = useState<Array<{
    tenantId: string;
    workspaceName: string;
    balance: number;
    totalQuota: number;
    usedQuota: number;
    usedToday: number;
    usedThisMonth: number;
    allowNegativeCredits: boolean;
    negativeCreditLimit: number;
    lowCreditThreshold: number;
    status: string;
  }>>([]);

  const [topupTenantId, setTopupTenantId] = useState('');
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('');
  const [savingTopup, setSavingTopup] = useState(false);

  const [adjustTenantId, setAdjustTenantId] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  const [policyTenantId, setPolicyTenantId] = useState('');
  const [policyAllowNegative, setPolicyAllowNegative] = useState(false);
  const [policyNegativeLimit, setPolicyNegativeLimit] = useState('0');
  const [policyLowThreshold, setPolicyLowThreshold] = useState('0');
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [audit, setAudit] = useState<QuotaAuditLogRow[] | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr('');
    setOk('');
    try {
      const me = await getCurrentUser(token);
      const aid = me.agencyId;
      if (!aid) {
        setErr('No agency on this session.');
        return;
      }
      setAgencyId(aid);
      const [settings, w, log] = await Promise.all([
        getQuotaAgencySettings(token),
        listAgencyCreditWallets(token),
        getQuotaAuditLog(token, { limit: 80 }),
      ]);
      setDefaultQuota(settings.defaultSubaccountQuota);
      setDefaultInput(String(settings.defaultSubaccountQuota ?? 0));
      setWallets(w);
      setAudit(log);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaveDefault = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const n = parseInt(defaultInput, 10);
    if (!Number.isFinite(n) || n < 0) {
      setErr('Default credits must be a non-negative number');
      return;
    }
    setSavingDefault(true);
    setErr('');
    setOk('');
    try {
      const r = await setAgencyDefaultQuota(token, n);
      setDefaultQuota(r.defaultSubaccountQuota);
      setDefaultInput(String(r.defaultSubaccountQuota));
      setAudit(await getQuotaAuditLog(token, { limit: 80 }));
      setOk('Saved default credits.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingDefault(false);
    }
  };

  const onTopup = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !topupTenantId) return;
    const amt = parseInt(topupAmount, 10);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr('Top-up amount must be a positive number');
      return;
    }
    setSavingTopup(true);
    setErr('');
    setOk('');
    try {
      const r = await topupSubaccountQuota(token, {
        tenantId: topupTenantId,
        amount: amt,
        note: topupNote.trim() || undefined,
      });
      setOk(`Top up applied: +${r.delta} credits.`);
      setTopupAmount('');
      setTopupNote('');
      setWallets(await listAgencyCreditWallets(token));
      setAudit(await getQuotaAuditLog(token, { limit: 80 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Top-up failed');
    } finally {
      setSavingTopup(false);
    }
  };

  const onAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !adjustTenantId) return;
    const delta = parseInt(adjustDelta, 10);
    const reason = adjustReason.trim();
    if (!Number.isFinite(delta) || delta === 0) {
      setErr('Adjustment delta must be a non-zero number.');
      return;
    }
    if (!reason) {
      setErr('Reason is required for manual adjustment.');
      return;
    }
    setSavingAdjust(true);
    setErr('');
    setOk('');
    try {
      const r = await adjustSubaccountCredits(token, { tenantId: adjustTenantId, delta, reason });
      setOk(`Manual adjustment applied: ${formatSignedInt(r.delta)} credits.`);
      setAdjustDelta('');
      setAdjustReason('');
      setWallets(await listAgencyCreditWallets(token));
      setAudit(await getQuotaAuditLog(token, { limit: 80 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Adjustment failed');
    } finally {
      setSavingAdjust(false);
    }
  };

  const onSavePolicy = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !policyTenantId) return;
    const negativeCreditLimit = parseInt(policyNegativeLimit, 10);
    const lowCreditThreshold = parseInt(policyLowThreshold, 10);
    if (!Number.isFinite(negativeCreditLimit)) {
      setErr('Negative credit limit must be a number.');
      return;
    }
    if (!Number.isFinite(lowCreditThreshold) || lowCreditThreshold < 0) {
      setErr('Low credit threshold must be a non-negative number.');
      return;
    }
    setSavingPolicy(true);
    setErr('');
    setOk('');
    try {
      await updateSubaccountCreditPolicy(token, {
        tenantId: policyTenantId,
        allowNegativeCredits: policyAllowNegative,
        negativeCreditLimit,
        lowCreditThreshold,
      });
      setOk('Wallet policy saved.');
      setWallets(await listAgencyCreditWallets(token));
      setAudit(await getQuotaAuditLog(token, { limit: 80 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Policy update failed');
    } finally {
      setSavingPolicy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Credits" eyebrow="Agency" />
        <LoadingBlock message="Loading credits…" />
      </div>
    );
  }

  const totals = wallets.reduce(
    (acc, w) => {
      acc.balanceSum += w.balance ?? 0;
      acc.usedToday += w.usedToday ?? 0;
      acc.low += w.status === 'LOW_CREDIT' ? 1 : 0;
      acc.paused += w.status === 'PAUSED_NO_CREDITS' ? 1 : 0;
      acc.overNeg += w.status === 'OVER_NEGATIVE_LIMIT' ? 1 : 0;
      return acc;
    },
    { balanceSum: 0, usedToday: 0, low: 0, paused: 0, overNeg: 0 },
  );

  return (
    <div>
      <PageHeader title="Credits" eyebrow="Agency" />
      <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 1rem', maxWidth: '48rem' }}>
        Monitor and manage credits across client workspaces. Debits occur per logical assistant reply (not per chat bubble).
      </p>
      {err ? <ErrorBanner message={err} /> : null}
      {ok ? <SuccessBanner message={ok} /> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <SectionCard title="Credits remaining" subtitle="Across client workspaces (sum of balances).">
          <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>{totals.balanceSum.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Credits used today" subtitle="Reply debits today across all workspaces.">
          <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>{totals.usedToday.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Low credit" subtitle="Workspaces at or below threshold.">
          <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>{totals.low.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Paused / over limit" subtitle="Blocked for automatic replies.">
          <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
            {(totals.paused + totals.overNeg).toLocaleString()}
          </p>
        </SectionCard>
      </div>

      <SectionCard title="Workspaces" subtitle="Credits per workspace.">
        {wallets.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>No wallets found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  {['Workspace', 'Balance', 'Used today', 'Used this month', 'Negative allowed', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.7rem' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wallets.map(w => (
                  <tr key={w.tenantId}>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{w.workspaceName}</div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{w.tenantId}</div>
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9', fontWeight: 800 }}>
                      {(w.balance ?? 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{(w.usedToday ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{(w.usedThisMonth ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{w.allowNegativeCredits ? 'Yes' : 'No'}</td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{creditStatusLabel(w.status)}</td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setTopupTenantId(w.tenantId);
                          setAdjustTenantId(w.tenantId);
                          setPolicyTenantId(w.tenantId);
                          setPolicyAllowNegative(Boolean(w.allowNegativeCredits));
                          setPolicyNegativeLimit(String(w.negativeCreditLimit ?? 0));
                          setPolicyLowThreshold(String(w.lowCreditThreshold ?? 0));
                        }}
                        style={{ padding: '0.35rem 0.55rem', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Default credits for new workspaces" subtitle="Stored on the agency; applied when wallets are created for new clients.">
        {defaultQuota !== null ? (
          <p style={{ fontSize: '0.85rem', color: '#334155', marginTop: 0 }}>
            Current default: <strong>{defaultQuota.toLocaleString()}</strong> credits
          </p>
        ) : null}
        <form onSubmit={onSaveDefault} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Default (credits)</span>
            <input
              value={defaultInput}
              onChange={e => setDefaultInput(e.target.value)}
              type="number"
              min={0}
              style={{ width: '8rem', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <button type="submit" disabled={savingDefault} style={{ padding: '0.45rem 0.9rem' }}>
            {savingDefault ? 'Saving…' : 'Save default'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Top up credits" subtitle="Add credits to a workspace.">
        <form
          onSubmit={onTopup}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}
        >
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Workspace</span>
            <select
              value={topupTenantId}
              onChange={e => setTopupTenantId(e.target.value)}
              required
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            >
              <option value="">— Select —</option>
              {wallets.map(w => (
                <option key={w.tenantId} value={w.tenantId}>
                  {w.workspaceName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Amount (credits to add)</span>
            <input
              value={topupAmount}
              onChange={e => setTopupAmount(e.target.value)}
              type="number"
              min={1}
              required
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Note (optional)</span>
            <input
              value={topupNote}
              onChange={e => setTopupNote(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <button type="submit" disabled={savingTopup} style={{ width: 'fit-content', padding: '0.45rem 0.9rem' }}>
            {savingTopup ? 'Applying…' : 'Top up credits'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Manual adjustment" subtitle="Increase or decrease total credits. Reason required.">
        <form onSubmit={onAdjust} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Workspace</span>
            <select
              value={adjustTenantId}
              onChange={e => setAdjustTenantId(e.target.value)}
              required
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            >
              <option value="">— Select —</option>
              {wallets.map(w => (
                <option key={w.tenantId} value={w.tenantId}>
                  {w.workspaceName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Delta (credits)</span>
            <input
              value={adjustDelta}
              onChange={e => setAdjustDelta(e.target.value)}
              type="number"
              required
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
              placeholder="+100 or -50"
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Reason</span>
            <input
              value={adjustReason}
              onChange={e => setAdjustReason(e.target.value)}
              required
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
              placeholder="e.g. goodwill credit / correction"
            />
          </label>
          <button type="submit" disabled={savingAdjust} style={{ width: 'fit-content', padding: '0.45rem 0.9rem' }}>
            {savingAdjust ? 'Applying…' : 'Apply adjustment'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Wallet policy" subtitle="Controls blocking and warnings.">
        <form onSubmit={onSavePolicy} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Workspace</span>
            <select
              value={policyTenantId}
              onChange={e => setPolicyTenantId(e.target.value)}
              required
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            >
              <option value="">— Select —</option>
              {wallets.map(w => (
                <option key={w.tenantId} value={w.tenantId}>
                  {w.workspaceName}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={policyAllowNegative} onChange={e => setPolicyAllowNegative(e.target.checked)} />
            <span style={{ fontSize: '0.85rem', color: '#334155' }}>Allow negative credits</span>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Negative credit limit</span>
            <input
              value={policyNegativeLimit}
              onChange={e => setPolicyNegativeLimit(e.target.value)}
              type="number"
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Low credit threshold</span>
            <input
              value={policyLowThreshold}
              onChange={e => setPolicyLowThreshold(e.target.value)}
              type="number"
              min={0}
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <button type="submit" disabled={savingPolicy} style={{ width: 'fit-content', padding: '0.45rem 0.9rem' }}>
            {savingPolicy ? 'Saving…' : 'Save policy'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Audit log" subtitle="Recent credit policy changes and manual top-ups">
        {!audit || audit.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>No entries yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.8rem',
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    When
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    Action
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    Who
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    Workspace
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#64748b',
                      fontSize: '0.7rem',
                    }}
                  >
                    Delta / range
                  </th>
                </tr>
              </thead>
              <tbody>
                {audit.map(row => (
                  <tr key={row.id}>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                      {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{row.action}</td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.8rem' }}>
                      {row.actorEmail ?? row.profile_id}
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9', fontFamily: 'inherit', fontSize: '0.72rem' }}>
                      {row.tenant_id ?? '—'}
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                      {row.action === 'agency.default_quota' ? (
                        <span>
                          {row.previous_total ?? '—'} → {row.new_total ?? '—'}
                        </span>
                      ) : (
                        <span>
                          +{row.delta} (total {row.previous_total ?? '—'} → {row.new_total ?? '—'})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0.5rem 0 0' }}>Agency: {agencyId}</p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
