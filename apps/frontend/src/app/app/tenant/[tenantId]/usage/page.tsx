'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getTenantById } from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  formatDateTime,
} from '@/components/app/mvp-ui';

type QuotaSnap = {
  totalQuota: number;
  usedQuota: number;
  remainingQuota: number;
  periodStart: string;
  periodEnd: string;
};

export default function TenantUsagePage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [quota, setQuota] = useState<QuotaSnap | null>(null);

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const t = await getTenantById(token, tenantId);
        if (cancelled) return;
        setQuota(t?.quota ?? null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load usage');
        if (!cancelled) setQuota(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId, loadAttempt]);

  const pct =
    quota && quota.totalQuota > 0
      ? Math.min(100, Math.round((quota.usedQuota / quota.totalQuota) * 100))
      : null;

  return (
    <div>
      {user?.agencyRole && (
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <Link href="/app/agency/tenants">← Client Workspaces</Link>
        </p>
      )}
      <PageHeader title="Usage" eyebrow="Client workspace" />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: '560px' }}>
        Track credits, message usage, and activity for this workspace.
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
          {quota ? (
            <div
              style={{
                border: '1px solid #dbeafe',
                borderRadius: '12px',
                padding: '1.25rem 1.35rem',
                background: 'linear-gradient(135deg, #f0f7ff 0%, #fff 42%)',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', fontWeight: 600 }}>
                    Credits left
                  </p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '2.1rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
                    {quota.remainingQuota.toLocaleString()}
                  </p>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', color: '#64748b' }}>
                    of {quota.totalQuota.toLocaleString()} in this period
                  </p>
                </div>
                <div style={{ textAlign: 'right', minWidth: '140px' }}>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Used</p>
                  <p style={{ margin: '0.1rem 0 0', fontSize: '1.35rem', fontWeight: 700, color: '#334155' }}>
                    {quota.usedQuota.toLocaleString()}
                  </p>
                  {pct != null ? (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>{pct}% of pool</p>
                  ) : null}
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
              <p style={{ margin: '0.65rem 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                Period {formatDateTime(String(quota.periodStart))} — {formatDateTime(String(quota.periodEnd))}
              </p>
            </div>
          ) : (
            <SectionCard title="Credits" subtitle="No usage has been recorded for this workspace yet.">
              <EmptyState
                title="No usage recorded yet"
                detail="Usage will appear here after the bot starts replying to customers."
              />
            </SectionCard>
          )}

          <div
            style={{
              border: '1px solid #eef0f4',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              background: '#fafbfc',
              fontSize: '0.82rem',
              color: '#64748b',
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: '#475569' }}>Trends &amp; analytics</strong> — Coming soon.
          </div>
        </>
      ) : null}
    </div>
  );
}
