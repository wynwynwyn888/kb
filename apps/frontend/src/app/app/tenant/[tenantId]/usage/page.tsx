'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getTenantCreditsLedger, getTenantCreditsUsage } from '@/lib/api';
import { ErrorBanner, LoadingBlock, PageHeader, SectionCard, formatDateTime } from '@/components/app/mvp-ui';
import { creditStatusLabel, type CreditStatus } from '@/lib/credits-ui';
import {
  ledgerMovementCustomerLabel,
  projectedCreditsRemainingDaysDisplay,
  softenLedgerCustomerDescription,
} from '@/lib/credits-billing-copy';

type UsageSnap = NonNullable<Awaited<ReturnType<typeof getTenantCreditsUsage>>>;

function resolveTenantIdFromParams(raw: Record<string, string | string[] | undefined> | null | undefined): string | null {
  const v = raw?.['tenantId'];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) return v[0].trim();
  return null;
}

function safeFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function TenantUsagePage() {
  const params = useParams();
  const tenantParam = useMemo(
    () => resolveTenantIdFromParams(params as Record<string, string | string[] | undefined>),
    [params],
  );
  const { token, user, loading: authLoading } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [usage, setUsage] = useState<UsageSnap | null>(null);
  const [ledger, setLedger] = useState<Array<{
    id: string;
    amount: number;
    type: string;
    movement_type: string | null;
    balance_after: number | null;
    description: string;
    conversation_id: string | null;
    created_at: string;
  }> | null>(null);

  /* Auth still resolving on direct load — do not fetch usage yet */
  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user || !token) {
      setLoading(false);
      setUsage(null);
      setLedger(null);
      setErr('');
      return;
    }

    if (!tenantParam) {
      setLoading(false);
      setUsage(null);
      setLedger(null);
      setErr('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErr('');
    void (async () => {
      try {
        const [u, l] = await Promise.all([
          getTenantCreditsUsage(token, tenantParam),
          getTenantCreditsLedger(token, tenantParam, 20),
        ]);
        if (cancelled) return;
        setUsage(u ?? null);
        setLedger(Array.isArray(l) ? l : []);
      } catch {
        if (!cancelled) {
          setErr('Usage data is temporarily unavailable. Please try again.');
          setUsage(null);
          setLedger([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, token, tenantParam, loadAttempt]);

  const usageSummary = usage ?? null;
  const ledgerItems = Array.isArray(ledger) ? ledger : [];

  const totalQuota = safeFiniteNumber(usageSummary?.totalQuota, 0);
  const usedQuota = safeFiniteNumber(usageSummary?.usedQuota, 0);
  const balance = safeFiniteNumber(usageSummary?.balance, 0);
  const usedToday = safeFiniteNumber(usageSummary?.usedToday, 0);
  const usedThisMonth = safeFiniteNumber(usageSummary?.usedThisMonth, 0);
  const usedThisYear = safeFiniteNumber(usageSummary?.usedThisYear, 0);
  const status = (usageSummary?.status != null ? String(usageSummary.status) : 'ACTIVE') as CreditStatus;

  const pct = totalQuota > 0 ? Math.min(100, Math.round((usedQuota / totalQuota) * 100)) : null;

  const dayOfMonth = new Date().getDate();
  const avgDaily =
    usageSummary != null ? Math.max(0, usedThisMonth / Math.max(1, dayOfMonth)) : null;
  const projectedOutcome = projectedCreditsRemainingDaysDisplay(balance, avgDaily, dayOfMonth);

  const showLow = status === 'LOW_CREDIT';
  const showPaused = status === 'PAUSED_NO_CREDITS' || status === 'OVER_NEGATIVE_LIMIT';

  if (authLoading) {
    return (
      <div>
        <PageHeader title="Usage" eyebrow="Client workspace" />
        <LoadingBlock message="Checking your workspace access…" />
      </div>
    );
  }

  if (!user || !token) {
    return (
      <div>
        <PageHeader title="Usage" eyebrow="Client workspace" />
        <LoadingBlock message="Signing you in…" />
      </div>
    );
  }

  if (!tenantParam) {
    return (
      <div>
        <PageHeader title="Usage" eyebrow="Client workspace" />
        <ErrorBanner message="Workspace context is unavailable from this URL. Open Usage from your workspace sidebar." />
      </div>
    );
  }

  return (
    <div>
      {user?.agencyRole && (
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <Link href="/app/agency/tenants">← Client Workspaces</Link>
        </p>
      )}
      <PageHeader title="Usage" eyebrow="Client workspace" />
      <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: '560px' }}>
        Track credits and usage for this workspace.
      </p>

      {err && (
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
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              background: 'var(--aisbp-surface-elevated, var(--aisbp-surface))',
              color: 'var(--aisbp-text, #0f172a)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Try again
          </button>
        </div>
      )}

      {loading && !err ? <LoadingBlock message="Loading usage…" /> : null}

      {!loading && !err ? (
        <>
          <div
            style={{
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              borderRadius: '12px',
              padding: '1.25rem 1.35rem',
              background: 'var(--aisbp-surface-elevated, var(--aisbp-surface))',
              marginBottom: '1rem',
              boxShadow: '0 1px 0 rgba(0, 0, 0, 0.04)',
            }}
          >
            {totalQuota === 0 && balance === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.75rem', lineHeight: 1.45 }}>
                No credits on file yet. Your agency can add credits from Agency → Credits.
              </p>
            ) : null}
            {usedThisMonth === 0 && balance > 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.75rem', lineHeight: 1.45 }}>
                No assistant replies have used credits yet this month. Your annual allowance and remaining balance are shown
                below.
              </p>
            ) : null}
              {showPaused ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <ErrorBanner message="Assistant replies are paused because this workspace has no credits remaining." />
                </div>
              ) : showLow ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div
                    style={{
                      border: '1px solid var(--aisbp-pill-warn-border, #fde68a)',
                      background: 'var(--aisbp-pill-warn-bg, #fffbeb)',
                      borderRadius: '10px',
                      padding: '0.75rem 0.9rem',
                      color: 'var(--aisbp-pill-warn-fg, #92400e)',
                      fontSize: '0.86rem',
                    }}
                  >
                    This workspace is running low on credits.
                  </div>
                </div>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--aisbp-muted, #64748b)', fontWeight: 600 }}>
                    Annual credits remaining
                  </p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '2.1rem', fontWeight: 800, color: 'var(--aisbp-text-heading, #0f172a)', lineHeight: 1.1 }}>
                    {balance.toLocaleString()}
                  </p>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', color: 'var(--aisbp-muted, #64748b)' }}>
                    of {totalQuota.toLocaleString()} annual allowance
                  </p>
                </div>
                <div style={{ textAlign: 'right', minWidth: '140px' }}>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)' }}>Credits used today</p>
                  <p style={{ margin: '0.1rem 0 0', fontSize: '1.35rem', fontWeight: 700, color: 'var(--aisbp-text-secondary, #334155)' }}>
                    {usedToday.toLocaleString()}
                  </p>
                  {pct != null ? (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>{pct}% of allowance used</p>
                  ) : null}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem', marginTop: '0.9rem' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)' }}>Credits used this month</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    {usedThisMonth.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)' }}>Credits used this year</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    {usedThisYear.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)' }}>Average daily usage</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    {avgDaily != null && Number.isFinite(avgDaily) ? avgDaily.toFixed(1) : '—'}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)' }}>Projected days remaining</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    {projectedOutcome.display}
                  </p>
                  {!projectedOutcome.showNumber ? (
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.35 }}>
                      Based on average daily usage this month once there is enough history.
                    </p>
                  ) : null}
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)' }}>Status</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    {creditStatusLabel(status)}
                  </p>
                </div>
              </div>
              <div
                style={{
                  marginTop: '1rem',
                  height: '8px',
                  borderRadius: '999px',
                  background: 'var(--aisbp-progress-track, #e8edf3)',
                  overflow: 'hidden',
                }}
                aria-hidden
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, pct ?? 0)}%`,
                    borderRadius: '999px',
                    background:
                      pct != null && pct > 85
                        ? 'color-mix(in srgb, var(--aisbp-pill-warn-fg, #f59e0b) 55%, transparent)'
                        : 'color-mix(in srgb, var(--aisbp-tenant-nav-active-text, #3b82f6) 50%, transparent)',
                    opacity: 0.85,
                  }}
                />
              </div>
            </div>

          <SectionCard
            title="Recent credits activity"
            subtitle="Top-ups, adjustments, and assistant reply usage appear here."
          >
            {ledgerItems.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>No ledger entries yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr>
                      {['Time', 'Type', 'Amount', 'Balance after', 'Reason'].map(h => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '0.45rem',
                            borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
                            color: 'var(--aisbp-muted, #64748b)',
                            fontSize: '0.7rem',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerItems.map((r, idx) => {
                      const mt = r?.movement_type != null ? String(r.movement_type) : '';
                      const typeLbl = ledgerMovementCustomerLabel(mt, r?.type != null ? String(r.type) : undefined);
                      const reasonPrimary = softenLedgerCustomerDescription(r?.description, mt);
                      return (
                        <tr key={typeof r?.id === 'string' && r.id.trim().length > 0 ? r.id : `ledger-row-${idx}`}>
                          <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)', color: 'var(--aisbp-text, #0f172a)' }}>
                            {r?.created_at ? formatDateTime(String(r.created_at)) : '—'}
                          </td>
                          <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)', color: 'var(--aisbp-text, #0f172a)' }}>{typeLbl}</td>
                          <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)', fontWeight: 750, color: 'var(--aisbp-text, #0f172a)' }}>
                            {String(r?.type ?? '').toUpperCase() === 'DEBIT' ? '-' : '+'}
                            {Math.abs(safeFiniteNumber(r?.amount)).toLocaleString()}
                          </td>
                          <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)', color: 'var(--aisbp-text, #0f172a)' }}>
                            {r?.balance_after != null && Number.isFinite(Number(r.balance_after))
                              ? Number(r.balance_after).toLocaleString()
                              : '—'}
                          </td>
                          <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)', color: 'var(--aisbp-text, #0f172a)' }}>
                            <div>{reasonPrimary}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
