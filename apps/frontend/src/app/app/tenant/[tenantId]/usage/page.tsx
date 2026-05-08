'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getTenantCreditsLedger, getTenantCreditsUsage } from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  formatDateTime,
} from '@/components/app/mvp-ui';
import { creditStatusLabel } from '@/lib/credits-ui';

type UsageSnap = NonNullable<Awaited<ReturnType<typeof getTenantCreditsUsage>>>;

export default function TenantUsagePage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [usage, setUsage] = useState<UsageSnap | null>(null);
  const [ledger, setLedger] = useState<Array<{
    id: string;
    amount: number;
    type: string;
    movement_type: string | null;
    balance_after: number | null;
    description: string;
    created_at: string;
  }> | null>(null);

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [u, l] = await Promise.all([
          getTenantCreditsUsage(token, tenantId),
          getTenantCreditsLedger(token, tenantId, 20),
        ]);
        if (cancelled) return;
        setUsage(u ?? null);
        setLedger(Array.isArray(l) ? l : []);
      } catch (e) {
        if (!cancelled) setErr('Usage data is temporarily unavailable. Please try again.');
        if (!cancelled) setUsage(null);
        if (!cancelled) setLedger([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId, loadAttempt]);

  const usageSummary = usage ?? null;
  const ledgerItems = Array.isArray(ledger) ? ledger : [];
  const dailyUsage = Array.isArray((usageSummary as unknown as { dailyUsage?: unknown })?.dailyUsage)
    ? ((usageSummary as unknown as { dailyUsage: unknown[] }).dailyUsage as unknown[])
    : [];

  const totalQuota = usageSummary?.totalQuota ?? 0;
  const usedQuota = usageSummary?.usedQuota ?? 0;
  const balance = usageSummary?.balance ?? 0;
  const usedToday = usageSummary?.usedToday ?? 0;
  const usedThisMonth = usageSummary?.usedThisMonth ?? 0;
  const status = usageSummary?.status ?? 'ACTIVE';

  const pct = totalQuota > 0 ? Math.min(100, Math.round((usedQuota / totalQuota) * 100)) : null;

  const avgDaily = usageSummary ? Math.max(0, usedThisMonth / Math.max(1, new Date().getDate())) : null;
  const projectedDays =
    usageSummary && avgDaily != null && avgDaily > 0
      ? Math.floor(Math.max(0, balance) / avgDaily)
      : null;

  const showLow = status === 'LOW_CREDIT';
  const showPaused = status === 'PAUSED_NO_CREDITS' || status === 'OVER_NEGATIVE_LIMIT';

  return (
    <div>
      {user?.agencyRole && (
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <Link href="/app/agency/tenants">← Client Workspaces</Link>
        </p>
      )}
      <PageHeader title="Usage" eyebrow="Client workspace" />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: '560px' }}>
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
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Try again
          </button>
        </div>
      )}

      {loading && !err ? <LoadingBlock message="Loading…" /> : null}

      {!loading && !err ? (
        <>
          {usageSummary ? (
            <div
              style={{
                border: '1px solid #dbeafe',
                borderRadius: '12px',
                padding: '1.25rem 1.35rem',
                background: 'linear-gradient(135deg, #f0f7ff 0%, #fff 42%)',
                marginBottom: '1rem',
              }}
            >
              {showPaused ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <ErrorBanner message="Automatic replies are paused because this workspace has no credits remaining." />
                </div>
              ) : showLow ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div
                    style={{
                      border: '1px solid #fde68a',
                      background: '#fffbeb',
                      borderRadius: '10px',
                      padding: '0.75rem 0.9rem',
                      color: '#92400e',
                      fontSize: '0.86rem',
                    }}
                  >
                    This workspace is running low on credits.
                  </div>
                </div>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', fontWeight: 600 }}>
                    Credits remaining
                  </p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '2.1rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
                    {balance.toLocaleString()}
                  </p>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', color: '#64748b' }}>
                    of {totalQuota.toLocaleString()} total
                  </p>
                </div>
                <div style={{ textAlign: 'right', minWidth: '140px' }}>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Credits used today</p>
                  <p style={{ margin: '0.1rem 0 0', fontSize: '1.35rem', fontWeight: 700, color: '#334155' }}>
                    {usedToday.toLocaleString()}
                  </p>
                  {pct != null ? (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>{pct}% of pool</p>
                  ) : null}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem', marginTop: '0.9rem' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Credits used this month</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: '#0f172a' }}>
                    {usedThisMonth.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Average daily usage</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: '#0f172a' }}>
                    {avgDaily != null && Number.isFinite(avgDaily) ? avgDaily.toFixed(1) : '—'}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Projected days remaining</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: '#0f172a' }}>
                    {projectedDays != null ? projectedDays.toLocaleString() : '—'}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Status</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '1.05rem', fontWeight: 750, color: '#0f172a' }}>
                    {creditStatusLabel(status)}
                  </p>
                </div>
              </div>
              <div
                style={{
                  marginTop: '1rem',
                  height: '8px',
                  borderRadius: '999px',
                  background: '#e2e8f0',
                  overflow: 'hidden',
                }}
                aria-hidden
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, pct ?? 0)}%`,
                    borderRadius: '999px',
                    background: pct != null && pct > 85 ? '#f59e0b' : '#3b82f6',
                  }}
                />
              </div>
            </div>
          ) : (
            <SectionCard title="Credits" subtitle="No usage has been recorded for this workspace yet.">
              <EmptyState
                title="No usage recorded yet"
                detail="Usage will appear here after the assistant starts replying to customers."
              />
            </SectionCard>
          )}

          <SectionCard title="Recent credits activity" subtitle="Latest movements in your credit ledger.">
            {ledgerItems.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>No ledger entries yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr>
                      {['Time', 'Type', 'Amount', 'Balance after', 'Reason'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.7rem' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerItems.map(r => (
                      <tr key={r.id}>
                        <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                          {r.created_at ? formatDateTime(String(r.created_at)) : '—'}
                        </td>
                        <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                          {(r.movement_type ?? r.type ?? '').replace(/_/g, ' ') || '—'}
                        </td>
                        <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9', fontWeight: 750 }}>
                          {String(r.type).toUpperCase() === 'DEBIT' ? '-' : '+'}
                          {Math.abs(r.amount ?? 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>
                          {r.balance_after != null ? Number(r.balance_after).toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '0.45rem', borderBottom: '1px solid #f1f5f9' }}>{r.description || '—'}</td>
                      </tr>
                    ))}
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
