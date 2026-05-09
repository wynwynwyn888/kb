'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  quotaAuditActionLabel,
  quotaAuditDeltaAndBalanceAfter,
  quotaAuditWorkspaceLabel,
} from '@/lib/credits-billing-copy';

function WorkspaceSupportDetails({ workspaceId }: { workspaceId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details style={{ marginTop: '0.25rem', fontSize: '0.72rem', color: '#64748b' }}>
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Support details</summary>
      <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{workspaceId}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(workspaceId).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
          style={{
            padding: '0.2rem 0.45rem',
            borderRadius: '6px',
            border: '1px solid #e2e8f0',
            background: '#fff',
            cursor: 'pointer',
            fontSize: '0.7rem',
          }}
        >
          {copied ? 'Copied' : 'Copy ID'}
        </button>
      </div>
    </details>
  );
}

export default function AgencyQuotasPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [defaultQuota, setDefaultQuota] = useState<number | null>(null);
  const [defaultInput, setDefaultInput] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);

  const [wallets, setWallets] = useState<
    Array<{
      tenantId: string;
      workspaceName: string;
      balance: number;
      totalQuota: number;
      usedQuota: number;
      usedToday: number;
      usedThisMonth: number;
      usedThisYear: number;
      allowNegativeCredits: boolean;
      negativeCreditLimit: number;
      lowCreditThreshold: number;
      status: string;
    }>
  >([]);

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

  const walletNameByTenant = useMemo(
    () => new Map(wallets.map(w => [w.tenantId, w.workspaceName])),
    [wallets],
  );

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
      setErr('Annual credits must be a non-negative whole number.');
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
      setOk('Default annual allowance saved.');
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
      setErr('Credits to add must be a positive whole number.');
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
      const bal =
        typeof r.balance === 'number'
          ? r.balance.toLocaleString()
          : '—';
      setOk(`Credits added. Remaining credits for this workspace: ${bal}.`);
      setTopupAmount('');
      setTopupNote('');
      setWallets(await listAgencyCreditWallets(token));
      setAudit(await getQuotaAuditLog(token, { limit: 80 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add credits');
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
      setErr('Change amount must be a non-zero whole number.');
      return;
    }
    if (!reason) {
      setErr('Please add a short reason.');
      return;
    }
    setSavingAdjust(true);
    setErr('');
    setOk('');
    try {
      const r = await adjustSubaccountCredits(token, { tenantId: adjustTenantId, delta, reason });
      setOk(`Adjustment applied: ${formatSignedInt(r.delta)} credits.`);
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
      setErr('Overage limit must be a whole number.');
      return;
    }
    if (!Number.isFinite(lowCreditThreshold) || lowCreditThreshold < 0) {
      setErr('Low-credit warning level must be zero or greater.');
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
      setOk('Credit policy saved.');
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
      <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 1rem', maxWidth: '48rem', lineHeight: 1.5 }}>
        Manage annual credit allowances for each client workspace. One assistant reply uses one credit, even if the reply is split
        into multiple chat bubbles.
      </p>
      {err ? <ErrorBanner message={err} /> : null}
      {ok ? <SuccessBanner message={ok} /> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <SectionCard title="Annual credits remaining" subtitle="Sum of unused credits across client workspaces.">
          <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>{totals.balanceSum.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Credits used today" subtitle="Assistant replies recorded today across all workspaces.">
          <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>{totals.usedToday.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Low-credit workspaces" subtitle="At or below the low-credit warning level.">
          <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>{totals.low.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Paused workspaces" subtitle="Assistant replies paused until credits are restored.">
          <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
            {(totals.paused + totals.overNeg).toLocaleString()}
          </p>
        </SectionCard>
      </div>

      <SectionCard title="Workspaces" subtitle="Annual allowance, remaining credits, and recent reply usage per workspace.">
        {wallets.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>No workspaces found yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  {(['Workspace', 'Remaining', 'Used today', 'Used this year', 'Overage', 'Status', 'Actions'] as const).map(h => (
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
                      <WorkspaceSupportDetails workspaceId={w.tenantId} />
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9', fontWeight: 800 }}>
                      {(w.balance ?? 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{(w.usedToday ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{(w.usedThisYear ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{w.allowNegativeCredits ? 'Allowed' : 'Not allowed'}</td>
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

      <SectionCard title="Default annual credit allowance" subtitle="Applied automatically when a new client workspace is created.">
        {defaultQuota !== null ? (
          <p style={{ fontSize: '0.85rem', color: '#334155', marginTop: 0 }}>
            Current default: <strong>{defaultQuota.toLocaleString()}</strong> credits
          </p>
        ) : null}
        <form onSubmit={onSaveDefault} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Annual credits</span>
            <input
              value={defaultInput}
              onChange={e => setDefaultInput(e.target.value)}
              type="number"
              min={0}
              style={{ width: '8rem', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <button type="submit" disabled={savingDefault} style={{ padding: '0.45rem 0.9rem' }}>
            {savingDefault ? 'Saving…' : 'Save allowance'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Add credits" subtitle="Increase a client workspace’s annual credit balance.">
        <form onSubmit={onTopup} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}>
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
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Credits to add</span>
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
            {savingTopup ? 'Applying…' : 'Add credits'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Adjust credits" subtitle="Use this for corrections, goodwill credits, or billing adjustments.">
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
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Change amount</span>
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
              placeholder="e.g. Billing correction, goodwill credit, plan adjustment"
            />
          </label>
          <button type="submit" disabled={savingAdjust} style={{ width: 'fit-content', padding: '0.45rem 0.9rem' }}>
            {savingAdjust ? 'Applying…' : 'Apply adjustment'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Credit policy" subtitle="Control low-credit warnings and temporary overage.">
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
            <span style={{ fontSize: '0.85rem', color: '#334155' }}>Allow temporary overage</span>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Overage limit</span>
            <input
              value={policyNegativeLimit}
              onChange={e => setPolicyNegativeLimit(e.target.value)}
              type="number"
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Low-credit warning level</span>
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

      <SectionCard title="Audit log" subtitle="Allowance changes and credit updates across workspaces.">
        {!audit || audit.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>No entries yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  {(['When', 'Action', 'Workspace', 'Changed by', 'Change', 'Balance after'] as const).map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.7rem' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audit.map(row => {
                  const { change, balanceAfter } = quotaAuditDeltaAndBalanceAfter(row);
                  const who =
                    typeof row.actorName === 'string' && row.actorName.trim()
                      ? row.actorName.trim()
                      : typeof row.actorEmail === 'string' && row.actorEmail.trim()
                        ? row.actorEmail.trim()
                        : '—';
                  return (
                    <tr key={row.id}>
                      <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                        {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{quotaAuditActionLabel(row.action)}</td>
                      <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                        {quotaAuditWorkspaceLabel(row, walletNameByTenant)}
                      </td>
                      <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.8rem' }}>{who}</td>
                      <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{change}</td>
                      <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{balanceAfter}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
