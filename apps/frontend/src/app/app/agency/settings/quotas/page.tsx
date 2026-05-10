'use client';

import type { CSSProperties } from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCurrentUser,
  getQuotaAgencySettings,
  saveAgencyCreditSettings,
  topupSubaccountQuota,
  adjustSubaccountCredits,
  listAgencyCreditWallets,
  updateSubaccountCreditPolicy,
  type CreditDeductionMethod,
} from '@/lib/api';
import {
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  SuccessBanner,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpSecondaryButtonStyle,
  mvpSelectStyle,
} from '@/components/app/mvp-ui';
import { creditStatusLabel, formatSignedInt } from '@/lib/credits-ui';

const tableTh: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.45rem',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
  color: 'var(--aisbp-muted, #64748b)',
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const tableTd: CSSProperties = {
  padding: '0.55rem 0.45rem',
  borderBottom: '1px solid var(--aisbp-border, #f1f5f9)',
  color: 'var(--aisbp-text, #0f172a)',
  fontSize: '0.84rem',
  verticalAlign: 'middle',
};

type ManageTab = 'add' | 'adjust' | 'rules';

function tabBtnStyle(active: boolean): CSSProperties {
  return {
    padding: '0.42rem 0.75rem',
    borderRadius: '8px',
    border: `1px solid ${active ? 'var(--aisbp-border-strong, #cbd5e1)' : 'var(--aisbp-border, #e2e8f0)'}`,
    background: active ? 'var(--aisbp-nav-active-bg, #fff)' : 'var(--aisbp-surface-muted, #f8fafc)',
    color: active ? 'var(--aisbp-text-heading, #0f172a)' : 'var(--aisbp-muted, #64748b)',
    fontSize: '0.82rem',
    fontWeight: active ? 750 : 600,
    cursor: 'pointer',
  };
}

export default function AgencyQuotasPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [defaultQuota, setDefaultQuota] = useState<number | null>(null);
  const [defaultInput, setDefaultInput] = useState('');
  const [deductionMethod, setDeductionMethod] = useState<CreditDeductionMethod>('PER_LOGICAL_REPLY');
  const [defaultAllowOverage, setDefaultAllowOverage] = useState(false);
  const [defaultOverageLimit, setDefaultOverageLimit] = useState('0');
  const [defaultLowCreditWarningEnabled, setDefaultLowCreditWarningEnabled] = useState(false);
  const [defaultLowCreditWarningLevel, setDefaultLowCreditWarningLevel] = useState('0');
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

  const [manageTenantId, setManageTenantId] = useState('');
  const [manageTab, setManageTab] = useState<ManageTab>('add');

  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('');
  const [savingTopup, setSavingTopup] = useState(false);

  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  const [policyAllowNegative, setPolicyAllowNegative] = useState(false);
  const [policyNegativeLimit, setPolicyNegativeLimit] = useState('0');
  const [policyLowThreshold, setPolicyLowThreshold] = useState('0');
  const [savingPolicy, setSavingPolicy] = useState(false);

  const selectedWallet = useMemo(
    () => wallets.find(w => w.tenantId === manageTenantId) ?? null,
    [wallets, manageTenantId],
  );

  const syncPolicyFromWallet = useCallback((w: (typeof wallets)[0] | null | undefined) => {
    if (!w) return;
    setPolicyAllowNegative(Boolean(w.allowNegativeCredits));
    setPolicyNegativeLimit(String(w.negativeCreditLimit ?? 0));
    setPolicyLowThreshold(String(w.lowCreditThreshold ?? 0));
  }, []);

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
      const [settings, w] = await Promise.all([getQuotaAgencySettings(token), listAgencyCreditWallets(token)]);
      setDefaultQuota(settings.defaultSubaccountQuota);
      setDefaultInput(String(settings.defaultSubaccountQuota ?? 0));
      setDeductionMethod(settings.deductionMethod ?? 'PER_LOGICAL_REPLY');
      setDefaultAllowOverage(Boolean(settings.defaultAllowOverage));
      setDefaultOverageLimit(String(settings.defaultOverageLimit ?? 0));
      setDefaultLowCreditWarningEnabled(Boolean(settings.defaultLowCreditWarningEnabled));
      setDefaultLowCreditWarningLevel(String(settings.defaultLowCreditWarningLevel ?? 0));
      setWallets(w);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (manageTenantId && selectedWallet) {
      syncPolicyFromWallet(selectedWallet);
    }
  }, [manageTenantId, selectedWallet, syncPolicyFromWallet]);

  const onSaveCreditSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const n = parseInt(defaultInput, 10);
    if (!Number.isFinite(n) || n < 0) {
      setErr('Default credits must be a non-negative whole number.');
      return;
    }
    const overLim = parseInt(defaultOverageLimit, 10);
    if (!Number.isFinite(overLim) || overLim < 0) {
      setErr('Overage limit must be zero or greater.');
      return;
    }
    const warnLevel = parseInt(defaultLowCreditWarningLevel, 10);
    if (!Number.isFinite(warnLevel) || warnLevel < 0) {
      setErr('Warning level must be zero or greater.');
      return;
    }
    setSavingDefault(true);
    setErr('');
    setOk('');
    try {
      const r = await saveAgencyCreditSettings(token, {
        defaultSubaccountQuota: n,
        deductionMethod,
        defaultAllowOverage,
        defaultOverageLimit: defaultAllowOverage ? overLim : 0,
        defaultLowCreditWarningEnabled,
        defaultLowCreditWarningLevel: defaultLowCreditWarningEnabled ? warnLevel : 0,
      });
      setDefaultQuota(r.defaultSubaccountQuota);
      setDefaultInput(String(r.defaultSubaccountQuota));
      setDeductionMethod(r.deductionMethod);
      setDefaultAllowOverage(r.defaultAllowOverage);
      setDefaultOverageLimit(String(r.defaultOverageLimit ?? 0));
      setDefaultLowCreditWarningEnabled(r.defaultLowCreditWarningEnabled);
      setDefaultLowCreditWarningLevel(String(r.defaultLowCreditWarningLevel ?? 0));
      setOk('Credit settings saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingDefault(false);
    }
  };

  const onTopup = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !manageTenantId) return;
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
        tenantId: manageTenantId,
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add credits');
    } finally {
      setSavingTopup(false);
    }
  };

  const onAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !manageTenantId) return;
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
      const r = await adjustSubaccountCredits(token, { tenantId: manageTenantId, delta, reason });
      setOk(`Adjustment applied: ${formatSignedInt(r.delta)} credits.`);
      setAdjustDelta('');
      setAdjustReason('');
      setWallets(await listAgencyCreditWallets(token));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Adjustment failed');
    } finally {
      setSavingAdjust(false);
    }
  };

  const onSavePolicy = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !manageTenantId) return;
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
        tenantId: manageTenantId,
        allowNegativeCredits: policyAllowNegative,
        negativeCreditLimit,
        lowCreditThreshold,
      });
      setOk('Credit rules saved.');
      setWallets(await listAgencyCreditWallets(token));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Policy update failed');
    } finally {
      setSavingPolicy(false);
    }
  };

  const selectWorkspaceForManage = (tenantId: string) => {
    setManageTenantId(tenantId);
    const w = wallets.find(x => x.tenantId === tenantId);
    syncPolicyFromWallet(w);
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

  const kpiNumber: CSSProperties = {
    margin: 0,
    fontSize: '1.35rem',
    fontWeight: 800,
    color: 'var(--aisbp-text-heading, #0f172a)',
  };

  const summaryGrid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '0.65rem',
    marginBottom: '1rem',
  };

  const summaryItem: CSSProperties = {
    padding: '0.55rem 0.65rem',
    borderRadius: '10px',
    border: '1px solid var(--aisbp-border, #e2e8f0)',
    background: 'var(--aisbp-surface-muted, #f8fafc)',
  };

  return (
    <div>
      <PageHeader title="Credits" eyebrow="Agency" />
      <p
        style={{
          fontSize: '0.8rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 1rem',
          maxWidth: '48rem',
          lineHeight: 1.5,
        }}
      >
        Agency-wide defaults, per-workspace balances, and tools to add credits or adjust rules for a selected workspace.
      </p>
      {err ? <ErrorBanner message={err} /> : null}
      {ok ? <SuccessBanner message={ok} /> : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <SectionCard title="Annual credits remaining" subtitle="Sum of unused credits across client workspaces.">
          <p style={kpiNumber}>{totals.balanceSum.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Credits used today" subtitle="Assistant replies recorded today across all workspaces.">
          <p style={kpiNumber}>{totals.usedToday.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Low-credit workspaces" subtitle="At or below the low-credit warning level.">
          <p style={kpiNumber}>{totals.low.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Paused workspaces" subtitle="Assistant replies paused until credits are restored.">
          <p style={kpiNumber}>{(totals.paused + totals.overNeg).toLocaleString()}</p>
        </SectionCard>
      </div>

      <SectionCard title="Credit settings" subtitle="Set the default credit rules for new workspaces.">
        <form onSubmit={onSaveCreditSettings} style={{ display: 'grid', gap: '1.25rem' }}>
          <div>
            <p
              style={{
                margin: '0 0 0.45rem',
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--aisbp-muted, #64748b)',
              }}
            >
              New workspace default credits
            </p>
            {defaultQuota !== null ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.65rem' }}>
                Saved default: <strong>{defaultQuota.toLocaleString()}</strong> credits
              </p>
            ) : null}
            <label style={{ ...mvpLabelStyle, maxWidth: '20rem', marginTop: 0 }}>
              Default credits for new workspace
              <input
                value={defaultInput}
                onChange={e => setDefaultInput(e.target.value)}
                type="number"
                min={0}
                style={{ ...mvpInputStyle, marginTop: '0.35rem' }}
              />
            </label>
          </div>

          <div
            style={{
              borderRadius: 10,
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              background: 'var(--aisbp-surface-muted, #f8fafc)',
              padding: '0.85rem 0.95rem',
            }}
          >
            <p
              style={{
                margin: '0 0 0.5rem',
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--aisbp-muted, #64748b)',
              }}
            >
              Credit deduction
            </p>
            <label style={{ ...mvpLabelStyle, marginTop: 0 }}>
              Method
              <select
                value={deductionMethod}
                onChange={e => setDeductionMethod(e.target.value as CreditDeductionMethod)}
                style={{ ...mvpSelectStyle, marginTop: '0.35rem', maxWidth: '22rem' }}
              >
                <option value="PER_LOGICAL_REPLY">Per logical assistant reply</option>
                <option value="PER_MESSAGE_BUBBLE">Per message bubble</option>
              </select>
            </label>
            <p style={{ margin: '0.55rem 0 0', fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.55 }}>
              {deductionMethod === 'PER_LOGICAL_REPLY' ? (
                <>
                  <strong>Per logical assistant reply:</strong> one assistant reply uses one credit, even if it is split into
                  multiple chat bubbles.
                </>
              ) : (
                <>
                  <strong>Per message bubble:</strong> each outbound chat bubble uses one credit.
                </>
              )}
            </p>
          </div>

          <div>
            <p
              style={{
                margin: '0 0 0.45rem',
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--aisbp-muted, #64748b)',
              }}
            >
              Default overage
            </p>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={defaultAllowOverage}
                onChange={e => setDefaultAllowOverage(e.target.checked)}
              />
              Allow temporary overage for new workspaces
            </label>
            {defaultAllowOverage ? (
              <label style={{ ...mvpLabelStyle, maxWidth: '16rem', marginTop: '0.65rem' }}>
                Overage limit (credits)
                <input
                  value={defaultOverageLimit}
                  onChange={e => setDefaultOverageLimit(e.target.value)}
                  type="number"
                  min={0}
                  style={{ ...mvpInputStyle, marginTop: '0.35rem' }}
                />
              </label>
            ) : null}
          </div>

          <div>
            <p
              style={{
                margin: '0 0 0.45rem',
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--aisbp-muted, #64748b)',
              }}
            >
              Low-credit warning
            </p>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={defaultLowCreditWarningEnabled}
                onChange={e => setDefaultLowCreditWarningEnabled(e.target.checked)}
              />
              Enable low-credit warning for new workspaces
            </label>
            {defaultLowCreditWarningEnabled ? (
              <label style={{ ...mvpLabelStyle, maxWidth: '16rem', marginTop: '0.65rem' }}>
                Warning level (credits remaining)
                <input
                  value={defaultLowCreditWarningLevel}
                  onChange={e => setDefaultLowCreditWarningLevel(e.target.value)}
                  type="number"
                  min={0}
                  style={{ ...mvpInputStyle, marginTop: '0.35rem' }}
                />
              </label>
            ) : null}
            <p
              style={{
                margin: '0.65rem 0 0',
                fontSize: '0.76rem',
                color: 'var(--aisbp-muted, #94a3b8)',
                lineHeight: 1.5,
                maxWidth: '36rem',
              }}
            >
              Used as the default warning threshold for new workspaces. Notification delivery is not enabled yet; this stores
              the threshold for future internal alerts.
            </p>
          </div>

          <button
            type="submit"
            disabled={savingDefault}
            style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingDefault ? 0.75 : 1 }}
          >
            {savingDefault ? 'Saving…' : 'Save credit settings'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Workspace credits" subtitle="Remaining balance, usage, and status for each workspace.">
        {wallets.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>No workspaces found yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr>
                  {(['Workspace', 'Remaining', 'Used today', 'Used this year', 'Overage', 'Status', 'Actions'] as const).map(h => (
                    <th key={h} style={tableTh}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wallets.map(w => (
                  <tr key={w.tenantId} style={{ background: 'var(--aisbp-table-row-bg, #fff)' }}>
                    <td style={{ ...tableTd, fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>{w.workspaceName}</td>
                    <td style={{ ...tableTd, fontWeight: 800, color: 'var(--aisbp-text, #0f172a)' }}>
                      {(w.balance ?? 0).toLocaleString()}
                    </td>
                    <td style={tableTd}>{(w.usedToday ?? 0).toLocaleString()}</td>
                    <td style={tableTd}>{(w.usedThisYear ?? 0).toLocaleString()}</td>
                    <td style={tableTd}>{w.allowNegativeCredits ? 'Allowed' : 'Not allowed'}</td>
                    <td style={tableTd}>{creditStatusLabel(w.status)}</td>
                    <td style={tableTd}>
                      <button
                        type="button"
                        onClick={() => {
                          selectWorkspaceForManage(w.tenantId);
                          setManageTab('add');
                        }}
                        style={{ ...mvpSecondaryButtonStyle, padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Manage selected workspace credits"
        subtitle="Pick one workspace, then add credits, adjust credits, or edit credit rules for that workspace only."
      >
        <label style={mvpLabelStyle}>
          Select workspace
          <select
            value={manageTenantId}
            onChange={e => {
              const id = e.target.value;
              if (id) selectWorkspaceForManage(id);
              else setManageTenantId('');
            }}
            style={mvpSelectStyle}
          >
            <option value="">Choose a workspace…</option>
            {wallets.map(w => (
              <option key={w.tenantId} value={w.tenantId}>
                {w.workspaceName}
              </option>
            ))}
          </select>
        </label>

        {!manageTenantId || !selectedWallet ? (
          <p style={{ fontSize: '0.86rem', color: 'var(--aisbp-muted, #64748b)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
            Choose a workspace above, or use <strong>Manage</strong> in the table to open this section with that workspace selected.
          </p>
        ) : (
          <>
            <div style={summaryGrid}>
              <div style={summaryItem}>
                <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 700, color: 'var(--aisbp-muted)', textTransform: 'uppercase' }}>
                  Remaining
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '1.1rem', fontWeight: 800, color: 'var(--aisbp-text-heading)' }}>
                  {(selectedWallet.balance ?? 0).toLocaleString()}
                </p>
              </div>
              <div style={summaryItem}>
                <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 700, color: 'var(--aisbp-muted)', textTransform: 'uppercase' }}>
                  Used today
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '1.1rem', fontWeight: 800, color: 'var(--aisbp-text-heading)' }}>
                  {(selectedWallet.usedToday ?? 0).toLocaleString()}
                </p>
              </div>
              <div style={summaryItem}>
                <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 700, color: 'var(--aisbp-muted)', textTransform: 'uppercase' }}>
                  Used this year
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '1.1rem', fontWeight: 800, color: 'var(--aisbp-text-heading)' }}>
                  {(selectedWallet.usedThisYear ?? 0).toLocaleString()}
                </p>
              </div>
              <div style={summaryItem}>
                <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 700, color: 'var(--aisbp-muted)', textTransform: 'uppercase' }}>
                  Overage
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem', fontWeight: 650, color: 'var(--aisbp-text-secondary)' }}>
                  {selectedWallet.allowNegativeCredits ? 'Allowed' : 'Not allowed'}
                </p>
              </div>
              <div style={summaryItem}>
                <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 700, color: 'var(--aisbp-muted)', textTransform: 'uppercase' }}>
                  Status
                </p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', fontWeight: 600, color: 'var(--aisbp-text-secondary)' }}>
                  {creditStatusLabel(selectedWallet.status)}
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                gap: '0.25rem',
                padding: '0.25rem',
                marginBottom: '0.85rem',
                borderRadius: 10,
                border: '1px solid var(--aisbp-border, #e2e8f0)',
                background: 'var(--aisbp-surface-muted, #f8fafc)',
              }}
            >
              <button type="button" onClick={() => setManageTab('add')} style={tabBtnStyle(manageTab === 'add')}>
                Add credits
              </button>
              <button type="button" onClick={() => setManageTab('adjust')} style={tabBtnStyle(manageTab === 'adjust')}>
                Adjust credits
              </button>
              <button type="button" onClick={() => setManageTab('rules')} style={tabBtnStyle(manageTab === 'rules')}>
                Credit rules
              </button>
            </div>

            <div
              style={{
                borderRadius: 12,
                border: '1px solid var(--aisbp-border, #e2e8f0)',
                background: 'var(--aisbp-surface, #fff)',
                padding: '1rem 1.05rem',
                maxWidth: '32rem',
              }}
            >
            {manageTab === 'add' ? (
              <form onSubmit={onTopup} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '28rem' }}>
                <label style={mvpLabelStyle}>
                  Credits to add
                  <input
                    value={topupAmount}
                    onChange={e => setTopupAmount(e.target.value)}
                    type="number"
                    min={1}
                    required
                    style={mvpInputStyle}
                  />
                </label>
                <label style={mvpLabelStyle}>
                  Note (optional)
                  <input value={topupNote} onChange={e => setTopupNote(e.target.value)} style={mvpInputStyle} />
                </label>
                <button
                  type="submit"
                  disabled={savingTopup}
                  style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingTopup ? 0.75 : 1 }}
                >
                  {savingTopup ? 'Applying…' : 'Add credits'}
                </button>
              </form>
            ) : null}

            {manageTab === 'adjust' ? (
              <form onSubmit={onAdjust} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '28rem' }}>
                <label style={mvpLabelStyle}>
                  Change amount
                  <input
                    value={adjustDelta}
                    onChange={e => setAdjustDelta(e.target.value)}
                    type="number"
                    required
                    style={mvpInputStyle}
                    placeholder="+100 or -50"
                  />
                </label>
                <label style={mvpLabelStyle}>
                  Reason
                  <input
                    value={adjustReason}
                    onChange={e => setAdjustReason(e.target.value)}
                    required
                    style={mvpInputStyle}
                    placeholder="Short description for your records"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingAdjust}
                  style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingAdjust ? 0.75 : 1 }}
                >
                  {savingAdjust ? 'Applying…' : 'Apply adjustment'}
                </button>
              </form>
            ) : null}

            {manageTab === 'rules' ? (
              <form onSubmit={onSavePolicy} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '28rem' }}>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.45 }}>
                  Overage and low-credit behavior apply to this workspace only.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={policyAllowNegative} onChange={e => setPolicyAllowNegative(e.target.checked)} />
                  <span style={{ color: 'var(--aisbp-text-secondary, #334155)' }}>Allow temporary overage</span>
                </label>
                <label style={mvpLabelStyle}>
                  Overage limit
                  <input
                    value={policyNegativeLimit}
                    onChange={e => setPolicyNegativeLimit(e.target.value)}
                    type="number"
                    style={mvpInputStyle}
                  />
                </label>
                <label style={mvpLabelStyle}>
                  Low-credit warning level
                  <input
                    value={policyLowThreshold}
                    onChange={e => setPolicyLowThreshold(e.target.value)}
                    type="number"
                    min={0}
                    style={mvpInputStyle}
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingPolicy}
                  style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingPolicy ? 0.75 : 1 }}
                >
                  {savingPolicy ? 'Saving…' : 'Save rules'}
                </button>
              </form>
            ) : null}
            </div>
          </>
        )}
      </SectionCard>

      <p style={{ fontSize: '0.86rem', color: 'var(--aisbp-muted, #64748b)', margin: '1rem 0 0', lineHeight: 1.5 }}>
        <Link href="/app/agency/log?focus=credits" style={{ fontWeight: 650, color: 'var(--aisbp-tenant-nav-active-text, #2563eb)' }}>
          View credit activity →
        </Link>
        <span style={{ display: 'block', marginTop: '0.35rem' }}>
          Opens the agency Activity log filtered to credits-related events.
        </span>
      </p>
    </div>
  );
}
