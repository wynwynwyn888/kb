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
  updateSubaccountWalletPlan,
  getAgencyLowCreditWarningSettings,
  saveAgencyLowCreditWarningSettings,
  getAgencyCreditResetReminderSettings,
  saveAgencyCreditResetReminderSettings,
  getGhlConnection,
  type CreditDeductionMethod,
  type AgencyLowCreditWarningSettings,
  type AgencyCreditResetReminderSettings,
} from '@/lib/api';
import {
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
} from '@/components/app/mvp-ui';
import { creditStatusLabel, formatSignedInt } from '@/lib/credits-ui';
import { formatWorkspaceDisplayName } from '@/lib/workspace-display';

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

type ManageTab = 'add' | 'adjust' | 'rules' | 'plan';
type SettingsTab = 'defaults' | 'warnings' | 'resetReminders';
type WalletSortKey = 'workspace' | 'remaining' | 'usedToday' | 'usedThisYear' | 'resetDate';
type SortDir = 'asc' | 'desc';

const SORTABLE_WALLET_COLUMNS: ReadonlyArray<{ key: WalletSortKey; label: string }> = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'remaining', label: 'Remaining' },
  { key: 'usedToday', label: 'Used today' },
  { key: 'usedThisYear', label: 'Used this year' },
  { key: 'resetDate', label: 'Next reset date' },
];

const ALLOWED_WARNING_THRESHOLDS = [2000, 1000, 500, 200] as const;
const ALLOWED_RESET_REMINDER_DAYS = [30, 14, 7, 3, 1] as const;

function formatResetDate(iso: string | null | undefined): string {
  if (!iso) return 'Not configured';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not configured';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function isoToDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

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

const sectionLabel: CSSProperties = {
  margin: '0 0 0.45rem',
  fontSize: '0.72rem',
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--aisbp-muted, #64748b)',
};

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
      periodStart: string | null;
      periodEnd: string | null;
      isAgencyWorkspace: boolean;
      creditsUnlimited: boolean;
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

  // Plan & reset date editor (per-workspace)
  const [planResetDate, setPlanResetDate] = useState<string>('');
  const [planTotalQuota, setPlanTotalQuota] = useState<string>('');
  const [savingPlan, setSavingPlan] = useState(false);

  // Agency low-credit warning settings
  const [warnSettings, setWarnSettings] = useState<AgencyLowCreditWarningSettings | null>(null);
  const [warnEnabled, setWarnEnabled] = useState(false);
  const [warnThresholds, setWarnThresholds] = useState<number[]>([]);
  const [warnTemplate, setWarnTemplate] = useState('');
  const [warnSendViaAgency, setWarnSendViaAgency] = useState(true);
  const [savingWarn, setSavingWarn] = useState(false);
  const [agencyWorkspaceCrmConnected, setAgencyWorkspaceCrmConnected] = useState<boolean | null>(null);
  const [agencyWorkspaceTenantId, setAgencyWorkspaceTenantId] = useState<string | null>(null);

  // Collapsible Agency credit settings panel (collapsed by default; shows summary + Edit button)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('defaults');

  const [walletSortKey, setWalletSortKey] = useState<WalletSortKey>('workspace');
  const [walletSortDir, setWalletSortDir] = useState<SortDir>('asc');

  const [resetReminderSettings, setResetReminderSettings] = useState<AgencyCreditResetReminderSettings | null>(null);
  const [resetReminderEnabled, setResetReminderEnabled] = useState(false);
  const [resetReminderDays, setResetReminderDays] = useState<number[]>([]);
  const [resetReminderTemplate, setResetReminderTemplate] = useState('');
  const [resetReminderSendViaAgency, setResetReminderSendViaAgency] = useState(true);
  const [savingResetReminder, setSavingResetReminder] = useState(false);

  const selectedWallet = useMemo(
    () => wallets.find(w => w.tenantId === manageTenantId) ?? null,
    [wallets, manageTenantId],
  );

  const syncPolicyFromWallet = useCallback((w: (typeof wallets)[0] | null | undefined) => {
    if (!w) return;
    setPolicyAllowNegative(Boolean(w.allowNegativeCredits));
    setPolicyNegativeLimit(String(w.negativeCreditLimit ?? 0));
    setPolicyLowThreshold(String(w.lowCreditThreshold ?? 0));
    setPlanResetDate(isoToDateInputValue(w.periodEnd));
    setPlanTotalQuota(String(w.totalQuota ?? 0));
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
      const [settings, w, warn, resetRem] = await Promise.all([
        getQuotaAgencySettings(token),
        listAgencyCreditWallets(token),
        getAgencyLowCreditWarningSettings(token).catch(() => null),
        getAgencyCreditResetReminderSettings(token).catch(() => null),
      ]);
      setDefaultQuota(settings.defaultSubaccountQuota);
      setDefaultInput(String(settings.defaultSubaccountQuota ?? 0));
      setDeductionMethod(settings.deductionMethod ?? 'PER_LOGICAL_REPLY');
      setDefaultAllowOverage(Boolean(settings.defaultAllowOverage));
      setDefaultOverageLimit(String(settings.defaultOverageLimit ?? 0));
      setDefaultLowCreditWarningEnabled(Boolean(settings.defaultLowCreditWarningEnabled));
      setDefaultLowCreditWarningLevel(String(settings.defaultLowCreditWarningLevel ?? 0));
      setWallets(w);
      if (warn) {
        setWarnSettings(warn);
        setWarnEnabled(Boolean(warn.enabled));
        setWarnThresholds(Array.isArray(warn.thresholds) ? warn.thresholds : []);
        setWarnTemplate(typeof warn.messageTemplate === 'string' ? warn.messageTemplate : '');
        setWarnSendViaAgency(Boolean(warn.sendViaAgencyWorkspace));
      }
      if (resetRem) {
        setResetReminderSettings(resetRem);
        setResetReminderEnabled(Boolean(resetRem.enabled));
        setResetReminderDays(Array.isArray(resetRem.daysBefore) ? resetRem.daysBefore : []);
        setResetReminderTemplate(typeof resetRem.messageTemplate === 'string' ? resetRem.messageTemplate : '');
        setResetReminderSendViaAgency(Boolean(resetRem.sendViaAgencyWorkspace));
      }
      try {
        const agencyWorkspace = w.find(x => x.isAgencyWorkspace);
        if (!agencyWorkspace) {
          setAgencyWorkspaceCrmConnected(false);
          setAgencyWorkspaceTenantId(null);
        } else {
          setAgencyWorkspaceTenantId(agencyWorkspace.tenantId);
          const conn = await getGhlConnection(token, agencyWorkspace.tenantId).catch(() => null);
          setAgencyWorkspaceCrmConnected(Boolean(conn?.connected));
        }
      } catch {
        setAgencyWorkspaceCrmConnected(null);
      }
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

  const onSavePlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !manageTenantId) return;
    if (!selectedWallet) return;
    if (selectedWallet.isAgencyWorkspace) {
      setErr('Plan cannot be edited on the agency workspace.');
      return;
    }
    const totalQuota = parseInt(planTotalQuota, 10);
    if (!Number.isFinite(totalQuota) || totalQuota < 0) {
      setErr('Annual allowance must be zero or greater.');
      return;
    }
    let periodEndIso: string | null = null;
    if (planResetDate.trim()) {
      const d = new Date(`${planResetDate}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) {
        setErr('Reset date is not a valid date.');
        return;
      }
      periodEndIso = d.toISOString();
    }
    setSavingPlan(true);
    setErr('');
    setOk('');
    try {
      await updateSubaccountWalletPlan(token, {
        tenantId: manageTenantId,
        totalQuota,
        periodEnd: periodEndIso,
      });
      setOk('Plan settings saved.');
      setWallets(await listAgencyCreditWallets(token));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save plan settings.');
    } finally {
      setSavingPlan(false);
    }
  };

  const toggleWarnThreshold = (n: number) => {
    setWarnThresholds(prev => {
      if (prev.includes(n)) return prev.filter(x => x !== n);
      return [...prev, n].sort((a, b) => b - a);
    });
  };

  const toggleResetReminderDay = (n: number) => {
    setResetReminderDays(prev => {
      if (prev.includes(n)) return prev.filter(x => x !== n);
      return [...prev, n].sort((a, b) => b - a);
    });
  };

  const onSaveResetReminders = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSavingResetReminder(true);
    setErr('');
    setOk('');
    try {
      const r = await saveAgencyCreditResetReminderSettings(token, {
        enabled: resetReminderEnabled,
        daysBefore: resetReminderDays,
        messageTemplate: resetReminderTemplate,
        sendViaAgencyWorkspace: resetReminderSendViaAgency,
      });
      setResetReminderSettings(r);
      setOk('Reset date reminder settings saved.');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save reset reminder settings.');
    } finally {
      setSavingResetReminder(false);
    }
  };

  const onSaveWarnings = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSavingWarn(true);
    setErr('');
    setOk('');
    try {
      const r = await saveAgencyLowCreditWarningSettings(token, {
        enabled: warnEnabled,
        thresholds: warnThresholds,
        messageTemplate: warnTemplate,
        sendViaAgencyWorkspace: warnSendViaAgency,
      });
      setWarnSettings(r);
      setOk('Low-credit warning settings saved.');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save warning settings.');
    } finally {
      setSavingWarn(false);
    }
  };

  const renderedPreview = useMemo(() => {
    const sample = {
      clientName: 'Alex',
      workspaceName: selectedWallet?.workspaceName || 'Acme HQ',
      remainingCredits: '450',
      threshold: '500',
      agencyName: 'Your Agency',
      resetDate: '10 May 2027',
    };
    const tpl = warnTemplate || '';
    return tpl
      .replace(/\{\{\s*clientName\s*\}\}/gi, sample.clientName)
      .replace(/\{\{\s*workspaceName\s*\}\}/gi, sample.workspaceName)
      .replace(/\{\{\s*remainingCredits\s*\}\}/gi, sample.remainingCredits)
      .replace(/\{\{\s*threshold\s*\}\}/gi, sample.threshold)
      .replace(/\{\{\s*agencyName\s*\}\}/gi, sample.agencyName)
      .replace(/\{\{\s*resetDate\s*\}\}/gi, sample.resetDate);
  }, [warnTemplate, selectedWallet]);

  const resetReminderPreview = useMemo(() => {
    const tpl = resetReminderTemplate || '';
    const sample = {
      clientName: 'Alex',
      workspaceName: selectedWallet?.workspaceName || 'Acme HQ',
      remainingCredits: '450',
      agencyName: 'Your Agency',
      resetDate: '10 May 2027',
      daysBefore: '7',
    };
    return tpl
      .replace(/\{\{\s*clientName\s*\}\}/gi, sample.clientName)
      .replace(/\{\{\s*workspaceName\s*\}\}/gi, sample.workspaceName)
      .replace(/\{\{\s*remainingCredits\s*\}\}/gi, sample.remainingCredits)
      .replace(/\{\{\s*agencyName\s*\}\}/gi, sample.agencyName)
      .replace(/\{\{\s*resetDate\s*\}\}/gi, sample.resetDate)
      .replace(/\{\{\s*daysBefore\s*\}\}/gi, sample.daysBefore);
  }, [resetReminderTemplate, selectedWallet]);

  // Excludes the agency workspace from totals — it has unlimited credits and is not a billable client.
  const clientWallets = useMemo(() => wallets.filter(w => !w.isAgencyWorkspace), [wallets]);
  const toggleWalletSort = (key: WalletSortKey) => {
    if (walletSortKey === key) {
      setWalletSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setWalletSortKey(key);
      setWalletSortDir(key === 'workspace' ? 'asc' : 'desc');
    }
  };
  const sortedClientWallets = useMemo(() => {
    const dir = walletSortDir === 'asc' ? 1 : -1;
    const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) * dir;
    const cmpNum = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1) * dir;
    const cmpDate = (a: string | null, b: string | null) => {
      const ta = a ? Date.parse(a) : NaN;
      const tb = b ? Date.parse(b) : NaN;
      const va = Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
      const vb = Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
      return cmpNum(va, vb);
    };
    return [...clientWallets].sort((a, b) => {
      switch (walletSortKey) {
        case 'workspace':
          return cmpStr(
            formatWorkspaceDisplayName({ name: a.workspaceName, id: a.tenantId, isAgencyWorkspace: false }),
            formatWorkspaceDisplayName({ name: b.workspaceName, id: b.tenantId, isAgencyWorkspace: false }),
          );
        case 'remaining':
          return cmpNum(a.balance ?? 0, b.balance ?? 0);
        case 'usedToday':
          return cmpNum(a.usedToday ?? 0, b.usedToday ?? 0);
        case 'usedThisYear':
          return cmpNum(a.usedThisYear ?? 0, b.usedThisYear ?? 0);
        case 'resetDate':
          return cmpDate(a.periodEnd, b.periodEnd);
        default:
          return 0;
      }
    });
  }, [clientWallets, walletSortKey, walletSortDir]);
  const agencyWalletRow = useMemo(() => wallets.find(w => w.isAgencyWorkspace) ?? null, [wallets]);
  const agencyWorkspacePresent = agencyWalletRow !== null;

  if (loading) {
    return (
      <div>
        <PageHeader title="Credits" eyebrow="Agency" />
        <LoadingBlock message="Loading credits…" />
      </div>
    );
  }

  const totals = clientWallets.reduce(
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

  // Short summary copy used by the collapsed Agency credit settings card.
  const warningSenderStatus: { label: string; tone: 'ok' | 'warn' } = !agencyWorkspacePresent
    ? { label: 'Agency workspace not set up', tone: 'warn' }
    : agencyWorkspaceCrmConnected === false
      ? { label: 'Agency workspace CRM not connected', tone: 'warn' }
      : agencyWorkspaceCrmConnected === true
        ? { label: 'Agency workspace connected', tone: 'ok' }
        : { label: 'Agency workspace ready', tone: 'ok' };

  const warnSummaryThresholdsLabel = warnThresholds.length > 0
    ? warnThresholds
        .slice()
        .sort((a, b) => b - a)
        .map(t => t.toLocaleString())
        .join(', ')
    : '—';

  const resetReminderSummaryDaysLabel =
    resetReminderDays.length > 0
      ? resetReminderDays
          .slice()
          .sort((a, b) => b - a)
          .map(d => `${d}d`)
          .join(', ')
      : '—';

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
        Per-workspace credit balances, manage tools for a selected workspace, and agency-wide credit settings.
      </p>
      {err ? <ErrorBanner message={err} /> : null}
      {ok ? <SuccessBanner message={ok} /> : null}

      {/* 1. KPI cards — totals exclude the agency workspace (unlimited credits). */}
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
        <SectionCard title="Credits used today" subtitle="Assistant replies recorded today across client workspaces.">
          <p style={kpiNumber}>{totals.usedToday.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Low-credit workspaces" subtitle="At or below the low-credit warning level.">
          <p style={kpiNumber}>{totals.low.toLocaleString()}</p>
        </SectionCard>
        <SectionCard title="Paused workspaces" subtitle="Assistant replies paused until credits are restored.">
          <p style={kpiNumber}>{(totals.paused + totals.overNeg).toLocaleString()}</p>
        </SectionCard>
      </div>

      {/* 2. Workspace credits — primary working area, directly under KPIs. */}
      <SectionCard title="Workspace credits" subtitle="Remaining balance, usage, next reset, and status for each workspace.">
        {agencyWalletRow ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.65rem',
              padding: '0.65rem 0.85rem',
              marginBottom: '0.85rem',
              borderRadius: 10,
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              background: 'var(--aisbp-surface-muted, #f8fafc)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.92rem', color: 'var(--aisbp-text-heading, #0f172a)' }}>
                  {formatWorkspaceDisplayName({
                    name: agencyWalletRow.workspaceName,
                    id: agencyWalletRow.tenantId,
                    isAgencyWorkspace: agencyWalletRow.isAgencyWorkspace,
                  })}
                </strong>
                <StatusPill label="Unlimited credits" tone="neutral" />
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
                Used to send automated low-credit warnings. Excluded from client totals.
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
              {agencyWorkspaceCrmConnected === true ? (
                <StatusPill label="CRM connected" tone="ok" />
              ) : agencyWorkspaceCrmConnected === false ? (
                <StatusPill label="CRM not connected" tone="warn" />
              ) : null}
              {agencyWorkspaceTenantId ? (
                <Link
                  href={`/app/agency/settings/ghl?subaccount=${encodeURIComponent(agencyWorkspaceTenantId)}`}
                  style={{ ...mvpSecondaryButtonStyle, padding: '0.35rem 0.7rem', fontSize: '0.82rem', textDecoration: 'none' }}
                >
                  Configure CRM
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {clientWallets.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
            No client workspaces yet.{' '}
            <Link href="/app/agency/tenants" style={{ fontWeight: 650, color: 'var(--aisbp-tenant-nav-active-text, #2563eb)' }}>
              Create one →
            </Link>
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr>
                  {SORTABLE_WALLET_COLUMNS.map(col => (
                    <th key={col.key} style={tableTh}>
                      <button
                        type="button"
                        onClick={() => toggleWalletSort(col.key)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: 'inherit',
                          font: 'inherit',
                          fontWeight: 'inherit',
                          letterSpacing: 'inherit',
                          textTransform: 'inherit',
                          cursor: 'pointer',
                        }}
                        aria-sort={walletSortKey === col.key ? (walletSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        {col.label}
                        <span aria-hidden style={{ fontSize: '0.7rem', opacity: walletSortKey === col.key ? 1 : 0.35 }}>
                          {walletSortKey === col.key ? (walletSortDir === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                  {(['Status', 'Actions'] as const).map(h => (
                    <th key={h} style={tableTh}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedClientWallets.map(w => (
                  <tr key={w.tenantId} style={{ background: 'var(--aisbp-table-row-bg, transparent)' }}>
                    <td style={{ ...tableTd, fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                      {formatWorkspaceDisplayName({
                        name: w.workspaceName,
                        id: w.tenantId,
                        isAgencyWorkspace: w.isAgencyWorkspace,
                      })}
                    </td>
                    <td style={{ ...tableTd, fontWeight: 800, color: 'var(--aisbp-text, #0f172a)' }}>
                      {(w.balance ?? 0).toLocaleString()}
                    </td>
                    <td style={tableTd}>{(w.usedToday ?? 0).toLocaleString()}</td>
                    <td style={tableTd}>{(w.usedThisYear ?? 0).toLocaleString()}</td>
                    <td style={tableTd}>{formatResetDate(w.periodEnd)}</td>
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

      {/* 3. Manage workspace credits — tabs surface only one form at a time. */}
      <SectionCard
        title="Manage workspace credits"
        subtitle="Pick one workspace, then add credits, adjust credits, edit the plan, or change rules for that workspace only."
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
            {clientWallets.map(w => (
              <option key={w.tenantId} value={w.tenantId}>
                {formatWorkspaceDisplayName({
                  name: w.workspaceName,
                  id: w.tenantId,
                  isAgencyWorkspace: w.isAgencyWorkspace,
                })}
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
                  Next reset date
                </p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', fontWeight: 650, color: 'var(--aisbp-text-secondary)' }}>
                  {formatResetDate(selectedWallet.periodEnd)}
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
              role="tablist"
              aria-label="Manage workspace credits"
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
              <button type="button" role="tab" aria-selected={manageTab === 'add'} onClick={() => setManageTab('add')} style={tabBtnStyle(manageTab === 'add')}>
                Add credits
              </button>
              <button type="button" role="tab" aria-selected={manageTab === 'adjust'} onClick={() => setManageTab('adjust')} style={tabBtnStyle(manageTab === 'adjust')}>
                Adjust credits
              </button>
              <button type="button" role="tab" aria-selected={manageTab === 'plan'} onClick={() => setManageTab('plan')} style={tabBtnStyle(manageTab === 'plan')}>
                Plan & reset date
              </button>
              <button type="button" role="tab" aria-selected={manageTab === 'rules'} onClick={() => setManageTab('rules')} style={tabBtnStyle(manageTab === 'rules')}>
                Rules
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

              {manageTab === 'plan' ? (
                <form onSubmit={onSavePlan} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '28rem' }}>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.45 }}>
                    Set this workspace&apos;s annual allowance and next reset date. Updating the reset date does not add or remove credits — use <strong>Add credits</strong> for that.
                  </p>
                  <label style={mvpLabelStyle}>
                    Annual allowance (credits)
                    <input
                      value={planTotalQuota}
                      onChange={e => setPlanTotalQuota(e.target.value)}
                      type="number"
                      min={0}
                      style={mvpInputStyle}
                    />
                  </label>
                  <label style={mvpLabelStyle}>
                    Next reset date
                    <input
                      value={planResetDate}
                      onChange={e => setPlanResetDate(e.target.value)}
                      type="date"
                      style={mvpInputStyle}
                    />
                  </label>
                  <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--aisbp-muted, #94a3b8)', lineHeight: 1.45 }}>
                    Current next reset: <strong>{formatResetDate(selectedWallet?.periodEnd)}</strong>
                  </p>
                  <button
                    type="submit"
                    disabled={savingPlan}
                    style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingPlan ? 0.75 : 1 }}
                  >
                    {savingPlan ? 'Saving…' : 'Save plan settings'}
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

      {/* 4. Agency credit settings — collapsed by default. Expands to two tabs. */}
      <SectionCard
        title="Agency credit settings"
        subtitle="Defaults for new workspaces, low-credit warnings, and reset-date reminders. Collapsed by default."
        accent="muted"
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.85rem',
            justifyContent: 'space-between',
            alignItems: settingsOpen ? 'flex-start' : 'center',
          }}
        >
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--aisbp-text-secondary, #334155)' }}>
              <div>
                <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>New workspace defaults: </span>
                <strong style={{ color: 'var(--aisbp-text-heading, #0f172a)' }}>
                  {(defaultQuota ?? 0).toLocaleString()} credits
                </strong>
                <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>
                  {' · '}
                  {deductionMethod === 'PER_LOGICAL_REPLY' ? 'Per logical reply' : 'Per message bubble'}
                  {' · '}
                  {defaultAllowOverage ? `Overage ${parseInt(defaultOverageLimit, 10) || 0}` : 'No overage'}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>Low-credit warning SMS: </span>
                <strong style={{ color: 'var(--aisbp-text-heading, #0f172a)' }}>
                  {warnEnabled ? 'Enabled' : 'Disabled'}
                </strong>
                <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>
                  {' · Thresholds: '}{warnSummaryThresholdsLabel}
                  {' · '}
                </span>
                <StatusPill label={warningSenderStatus.label} tone={warningSenderStatus.tone} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>Reset date reminder SMS: </span>
                <strong style={{ color: 'var(--aisbp-text-heading, #0f172a)' }}>
                  {resetReminderEnabled ? 'Enabled' : 'Disabled'}
                </strong>
                <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>
                  {' · Triggers: '}
                  {resetReminderSummaryDaysLabel} before reset
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(v => !v)}
            aria-expanded={settingsOpen}
            style={{ ...mvpSecondaryButtonStyle, padding: '0.45rem 0.85rem', fontSize: '0.84rem' }}
          >
            {settingsOpen ? 'Close settings' : 'Edit settings'}
          </button>
        </div>

        {settingsOpen ? (
          <div style={{ marginTop: '1rem' }}>
            <div
              role="tablist"
              aria-label="Agency credit settings"
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
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'defaults'}
                onClick={() => setSettingsTab('defaults')}
                style={tabBtnStyle(settingsTab === 'defaults')}
              >
                New workspace defaults
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'warnings'}
                onClick={() => setSettingsTab('warnings')}
                style={tabBtnStyle(settingsTab === 'warnings')}
              >
                Low-credit warning automation
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'resetReminders'}
                onClick={() => setSettingsTab('resetReminders')}
                style={tabBtnStyle(settingsTab === 'resetReminders')}
              >
                Reset date reminders
              </button>
            </div>

            <div
              style={{
                borderRadius: 12,
                border: '1px solid var(--aisbp-border, #e2e8f0)',
                background: 'var(--aisbp-surface, #fff)',
                padding: '1rem 1.05rem',
              }}
            >
              {settingsTab === 'defaults' ? (
                <form onSubmit={onSaveCreditSettings} style={{ display: 'grid', gap: '1.25rem' }}>
                  <div>
                    <p style={sectionLabel}>Default credits for new workspace</p>
                    {defaultQuota !== null ? (
                      <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.65rem' }}>
                        Saved default: <strong>{defaultQuota.toLocaleString()}</strong> credits
                      </p>
                    ) : null}
                    <label style={{ ...mvpLabelStyle, maxWidth: '20rem', marginTop: 0 }}>
                      Default credits
                      <input
                        value={defaultInput}
                        onChange={e => setDefaultInput(e.target.value)}
                        type="number"
                        min={0}
                        style={{ ...mvpInputStyle, marginTop: '0.35rem' }}
                      />
                    </label>
                  </div>

                  <div>
                    <p style={sectionLabel}>Credit deduction method</p>
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
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.55 }}>
                      {deductionMethod === 'PER_LOGICAL_REPLY'
                        ? 'One assistant reply uses one credit, even if it is split into multiple chat bubbles.'
                        : 'Each outbound chat bubble uses one credit.'}
                    </p>
                  </div>

                  <div>
                    <p style={sectionLabel}>Default overage for new workspaces</p>
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

                  <button
                    type="submit"
                    disabled={savingDefault}
                    style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingDefault ? 0.75 : 1 }}
                  >
                    {savingDefault ? 'Saving…' : 'Save defaults'}
                  </button>
                </form>
              ) : null}

              {settingsTab === 'warnings' ? (
                <form onSubmit={onSaveWarnings} style={{ display: 'grid', gap: '1rem' }}>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={warnEnabled}
                      onChange={e => setWarnEnabled(e.target.checked)}
                    />
                    Enable warning SMS
                  </label>

                  <div>
                    <p style={sectionLabel}>Sender</p>
                    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem' }}>
                      <input
                        type="radio"
                        checked={warnSendViaAgency}
                        onChange={() => setWarnSendViaAgency(true)}
                      />
                      Agency workspace
                    </label>
                    {!agencyWorkspacePresent ? (
                      <div
                        style={{
                          marginTop: '0.55rem',
                          padding: '0.6rem 0.75rem',
                          borderRadius: 8,
                          border: '1px solid var(--aisbp-pill-warn-border, #fde68a)',
                          background: 'var(--aisbp-pill-warn-bg, #fffbeb)',
                          color: 'var(--aisbp-pill-warn-fg, #b45309)',
                          fontSize: '0.82rem',
                          lineHeight: 1.5,
                        }}
                      >
                        Set up the agency workspace before enabling warning SMS.{' '}
                        <Link href="/app/agency/tenants" style={{ fontWeight: 650, color: 'inherit' }}>
                          Set up agency workspace →
                        </Link>
                      </div>
                    ) : agencyWorkspaceCrmConnected === false ? (
                      <div
                        style={{
                          marginTop: '0.55rem',
                          padding: '0.6rem 0.75rem',
                          borderRadius: 8,
                          border: '1px solid var(--aisbp-pill-warn-border, #fde68a)',
                          background: 'var(--aisbp-pill-warn-bg, #fffbeb)',
                          color: 'var(--aisbp-pill-warn-fg, #b45309)',
                          fontSize: '0.82rem',
                          lineHeight: 1.5,
                        }}
                      >
                        Warning SMS is paused until the agency workspace is connected to CRM.{' '}
                        <Link
                          href={agencyWorkspaceTenantId ? `/app/agency/settings/ghl?subaccount=${encodeURIComponent(agencyWorkspaceTenantId)}` : '/app/agency/tenants'}
                          style={{ fontWeight: 650, color: 'inherit' }}
                        >
                          Configure CRM →
                        </Link>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <p style={sectionLabel}>Thresholds</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.4rem', maxWidth: '32rem' }}>
                      {(warnSettings?.allowedThresholds && warnSettings.allowedThresholds.length > 0
                        ? warnSettings.allowedThresholds
                        : ALLOWED_WARNING_THRESHOLDS
                      ).map(t => (
                        <label
                          key={t}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem', cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={warnThresholds.includes(t)}
                            onChange={() => toggleWarnThreshold(t)}
                          />
                          {t.toLocaleString()} credits
                        </label>
                      ))}
                    </div>
                    <p style={{ margin: '0.45rem 0 0', fontSize: '0.76rem', color: 'var(--aisbp-muted, #94a3b8)', lineHeight: 1.45 }}>
                      One warning per threshold per workspace per billing period.
                    </p>
                  </div>

                  <div>
                    <p style={sectionLabel}>Warning message</p>
                    <textarea
                      value={warnTemplate}
                      onChange={e => setWarnTemplate(e.target.value)}
                      placeholder="Hi {{clientName}}, your AISalesBot Pro workspace &quot;{{workspaceName}}&quot; is running low on credits."
                      rows={5}
                      style={{
                        ...mvpInputStyle,
                        width: '100%',
                        maxWidth: '40rem',
                        minHeight: '6rem',
                        fontFamily: 'inherit',
                        lineHeight: 1.5,
                        resize: 'vertical',
                      }}
                    />
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.74rem', color: 'var(--aisbp-muted, #94a3b8)', lineHeight: 1.5 }}>
                      Variables: <code>{'{{clientName}}'}</code>, <code>{'{{workspaceName}}'}</code>, <code>{'{{remainingCredits}}'}</code>,{' '}
                      <code>{'{{threshold}}'}</code>, <code>{'{{agencyName}}'}</code>, <code>{'{{resetDate}}'}</code>.
                    </p>
                  </div>

                  <div>
                    <p style={sectionLabel}>Preview</p>
                    <pre
                      style={{
                        margin: 0,
                        padding: '0.7rem 0.85rem',
                        borderRadius: 10,
                        border: '1px solid var(--aisbp-border, #e2e8f0)',
                        background: 'var(--aisbp-surface-muted, #f8fafc)',
                        color: 'var(--aisbp-text, #0f172a)',
                        fontSize: '0.82rem',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'inherit',
                        maxWidth: '40rem',
                      }}
                    >
                      {renderedPreview || '(Add a message above to see a preview.)'}
                    </pre>
                  </div>

                  <button
                    type="submit"
                    disabled={savingWarn}
                    style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingWarn ? 0.75 : 1 }}
                  >
                    {savingWarn ? 'Saving…' : 'Save warning settings'}
                  </button>
                </form>
              ) : null}

              {settingsTab === 'resetReminders' ? (
                <form onSubmit={onSaveResetReminders} style={{ display: 'grid', gap: '1rem' }}>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={resetReminderEnabled}
                      onChange={e => setResetReminderEnabled(e.target.checked)}
                    />
                    Enable reset date reminder SMS
                  </label>

                  <div>
                    <p style={sectionLabel}>Sender</p>
                    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem' }}>
                      <input
                        type="radio"
                        checked={resetReminderSendViaAgency}
                        onChange={() => setResetReminderSendViaAgency(true)}
                      />
                      Agency workspace
                    </label>
                  </div>

                  <div>
                    <p style={sectionLabel}>Remind before next reset date</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.4rem', maxWidth: '32rem' }}>
                      {(resetReminderSettings?.allowedDaysBefore?.length
                        ? resetReminderSettings.allowedDaysBefore
                        : ALLOWED_RESET_REMINDER_DAYS
                      ).map(d => (
                        <label
                          key={d}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem', cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={resetReminderDays.includes(d)}
                            onChange={() => toggleResetReminderDay(d)}
                          />
                          {d} day{d === 1 ? '' : 's'} before
                        </label>
                      ))}
                    </div>
                    <p style={{ margin: '0.45rem 0 0', fontSize: '0.76rem', color: 'var(--aisbp-muted, #94a3b8)', lineHeight: 1.45 }}>
                      One reminder per trigger per workspace per billing period.
                    </p>
                  </div>

                  <div>
                    <p style={sectionLabel}>Reminder message</p>
                    <textarea
                      value={resetReminderTemplate}
                      onChange={e => setResetReminderTemplate(e.target.value)}
                      placeholder="Hi {{clientName}}, your workspace credit plan resets on {{resetDate}}."
                      rows={5}
                      style={{
                        ...mvpInputStyle,
                        width: '100%',
                        maxWidth: '40rem',
                        minHeight: '6rem',
                        fontFamily: 'inherit',
                        lineHeight: 1.5,
                        resize: 'vertical',
                      }}
                    />
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.74rem', color: 'var(--aisbp-muted, #94a3b8)', lineHeight: 1.5 }}>
                      Variables: <code>{'{{clientName}}'}</code>, <code>{'{{workspaceName}}'}</code>, <code>{'{{remainingCredits}}'}</code>,{' '}
                      <code>{'{{resetDate}}'}</code>, <code>{'{{daysBefore}}'}</code>, <code>{'{{agencyName}}'}</code>.
                    </p>
                  </div>

                  <div>
                    <p style={sectionLabel}>Preview</p>
                    <pre
                      style={{
                        margin: 0,
                        padding: '0.7rem 0.85rem',
                        borderRadius: 10,
                        border: '1px solid var(--aisbp-border, #e2e8f0)',
                        background: 'var(--aisbp-surface-muted, #f8fafc)',
                        color: 'var(--aisbp-text, #0f172a)',
                        fontSize: '0.82rem',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'inherit',
                        maxWidth: '40rem',
                      }}
                    >
                      {resetReminderPreview || '(Add a message above to see a preview.)'}
                    </pre>
                  </div>

                  <button
                    type="submit"
                    disabled={savingResetReminder}
                    style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingResetReminder ? 0.75 : 1 }}
                  >
                    {savingResetReminder ? 'Saving…' : 'Save reminder settings'}
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}
      </SectionCard>

      {/* 5. Footer link to the credit activity log. */}
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
