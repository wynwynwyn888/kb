'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAgencyAiConfig,
  getAgencyById,
  getCurrentUser,
  getGhlConnection,
  getQuotaAuditLog,
  getTenantQuota,
  getTenantsByAgency,
} from '@/lib/api';
import {
  ErrorBanner,
  KeyValueRows,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
} from '@/components/app/mvp-ui';

function fmtCompact(n: number) {
  return n.toLocaleString();
}

function formatAuditDescription(
  row: {
    action: string;
    previous_total: number | null;
    new_total: number | null;
    delta?: number;
    metadata?: unknown;
  },
): string {
  const m = (row.metadata ?? null) as Record<string, unknown> | null;
  const a = row.action;
  if (a === 'subaccount.create' && m?.['name']) {
    return `Subaccount created: ${String(m['name'])}`;
  }
  if (a === 'subaccount.renamed' && m?.['previousName'] && m?.['newName']) {
    return `Subaccount renamed: ${String(m['previousName'])} → ${String(m['newName'])}`;
  }
  if (a === 'subaccount.deleted' && m?.['name']) {
    return `Subaccount removed: ${String(m['name'])}`;
  }
  if (a === 'agency.ai_settings' && m) {
    const p = m['provider'];
    const k = m['keyRotated'];
    const sa = m['setAsActive'];
    const am = m['defaultModel'];
    return `AI settings: provider ${p ?? '—'}${am ? `, model ${am}` : ''}${
      sa ? ', set as live provider' : ''
    }${k ? ', API key updated' : ''}`;
  }
  if (a === 'agency.active_provider' && m?.['newActiveProvider']) {
    return `Active provider: ${String(m['previousActiveProvider'] ?? '—')} → ${String(m['newActiveProvider'])}`;
  }
  if (a === 'agency.reply_policy') {
    return 'Subaccount reply policy (governance) updated';
  }
  if (a === 'agency.default_quota') {
    return `Default quota: ${row.previous_total ?? '—'} → ${row.new_total ?? '—'}`;
  }
  if (a === 'subaccount.topup') {
    return `Subaccount quota top-up (${row.previous_total ?? '—'} → ${row.new_total ?? '—'})`;
  }
  return a;
}

type GhlBreakdown = {
  connected: number;
  invalid: number;
  error: number;
  disconnected: number;
  fetchFailed: number;
};

export default function AgencyHomePage() {
  const { token, user } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [tenantCount, setTenantCount] = useState<number | null>(null);
  const [withGhlLocationId, setWithGhlLocationId] = useState<number | null>(null);
  const [ghlBreakdown, setGhlBreakdown] = useState<GhlBreakdown | null>(null);
  const [ghlConnectedCount, setGhlConnectedCount] = useState<number | null>(null);
  const [aiSnap, setAiSnap] = useState<{
    hasKey: boolean;
    provider: string;
    model: string;
  } | null>(null);
  const [usageAgg, setUsageAgg] = useState<{
    subaccountsWithQuota: number;
    usedSum: number;
    totalSum: number;
    periodNote: string | null;
  } | null>(null);
  const [firstTenantId, setFirstTenantId] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [err, setErr] = useState('');
  const [lowQuota, setLowQuota] = useState<Array<{ id: string; name: string; remaining: number; total: number }>>([]);
  const [recentAudit, setRecentAudit] = useState<
    Array<{
      id: string;
      action: string;
      created_at: string;
      actorEmail?: string | null;
      previous_total: number | null;
      new_total: number | null;
      delta?: number;
      tenant_id: string | null;
      metadata?: unknown;
    }>
  >([]);

  useEffect(() => {
    const agencyId = user?.agencyId;
    if (!token || !agencyId) return;
    let cancelled = false;
    (async () => {
      setSnapshotLoading(true);
      setErr('');
      try {
        const [me, agency, tenants, ai, audit] = await Promise.all([
          getCurrentUser(token),
          getAgencyById(token, agencyId),
          getTenantsByAgency(token, agencyId),
          getAgencyAiConfig(token).catch(() => null),
          getQuotaAuditLog(token, { limit: 12 }).catch(() => []),
        ]);
        if (cancelled) return;
        setRole(me.agencyRole ?? null);
        setAgencyName(agency?.name ?? agencyId);
        const tlist = Array.isArray(tenants) ? tenants : [];
        setTenantCount(tlist.length);
        setWithGhlLocationId(tlist.filter(t => t.ghlLocationId && String(t.ghlLocationId).trim() !== '').length);
        setFirstTenantId(tlist[0]?.id ?? null);
        if (ai) {
          const ap = ai.activeProvider ?? ai.provider;
          const hasKey = Boolean((ap && ai.keysPresent?.[ap]) ?? ai.hasApiKey);
          setAiSnap({
            hasKey,
            provider: ap || '—',
            model: ai.activeModel ?? (ai.defaultModel || '—'),
          });
        } else {
          setAiSnap(null);
        }
        setRecentAudit(audit);

        if (tlist.length === 0) {
          setGhlBreakdown({ connected: 0, invalid: 0, error: 0, disconnected: 0, fetchFailed: 0 });
          setGhlConnectedCount(0);
          setUsageAgg({ subaccountsWithQuota: 0, usedSum: 0, totalSum: 0, periodNote: null });
          setLowQuota([]);
        } else {
          const [qRows, ghlRows] = await Promise.all([
            Promise.all(tlist.map(t => getTenantQuota(token, t.id).catch(() => null as null))),
            Promise.all(tlist.map(t => getGhlConnection(token, t.id).catch(() => null as null))),
          ]);
          if (cancelled) return;
          const breakdown: GhlBreakdown = { connected: 0, invalid: 0, error: 0, disconnected: 0, fetchFailed: 0 };
          for (const c of ghlRows) {
            if (c == null) {
              breakdown.fetchFailed++;
              continue;
            }
            if (c.connected && c.status === 'CONNECTED') {
              breakdown.connected++;
            } else if (c.status === 'INVALID') breakdown.invalid++;
            else if (c.status === 'ERROR') breakdown.error++;
            else if (c.status === 'DISCONNECTED') breakdown.disconnected++;
          }
          setGhlBreakdown(breakdown);
          setGhlConnectedCount(breakdown.connected);
          const ok = qRows.filter((q): q is NonNullable<typeof q> => q != null);
          const usedSum = ok.reduce((s, q) => s + (q.usedQuota ?? 0), 0);
          const totalSum = ok.reduce((s, q) => s + (q.totalQuota ?? 0), 0);
          const periods = new Set(
            ok.map(q => `${q.periodStart ?? ''}\n${q.periodEnd ?? ''}`).filter(p => p.trim() !== '\n'),
          );
          setUsageAgg({
            subaccountsWithQuota: ok.length,
            usedSum,
            totalSum,
            periodNote:
              periods.size > 1
                ? 'Billing windows differ by subaccount—treat the sum as indicative.'
                : ok.length
                  ? null
                  : 'No quota rows returned for these subaccounts.',
          });
          const low: Array<{ id: string; name: string; remaining: number; total: number }> = [];
          tlist.forEach((row, i) => {
            const q = qRows[i];
            if (q && q.totalQuota > 0 && q.remainingQuota / q.totalQuota < 0.15) {
              low.push({
                id: row.id,
                name: row.name,
                remaining: q.remainingQuota,
                total: q.totalQuota,
              });
            }
          });
          setLowQuota(low);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load agency snapshot');
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.agencyId, loadAttempt]);

  const usagePct =
    usageAgg && usageAgg.totalSum > 0
      ? Math.min(100, Math.round((usageAgg.usedSum / usageAgg.totalSum) * 100))
      : null;

  const withoutLocationId =
    tenantCount != null && withGhlLocationId != null ? Math.max(0, tenantCount - withGhlLocationId) : null;

  const operationalFlags = useMemo(() => {
    const flags: { text: string; tone: 'warn' | 'ok' }[] = [];
    if (aiSnap && !aiSnap.hasKey)
      flags.push({ text: 'No API key for the active AI provider — live generation will fail until credentials are saved.', tone: 'warn' });
    if (lowQuota.length > 0)
      flags.push({
        text: `${lowQuota.length} subaccount(s) are below 15% remaining quota: ${lowQuota
          .slice(0, 3)
          .map(l => l.name)
          .join(', ')}${lowQuota.length > 3 ? '…' : ''}.`,
        tone: 'warn',
      });
    if (ghlBreakdown) {
      if (ghlBreakdown.invalid > 0)
        flags.push({ text: `${ghlBreakdown.invalid} GHL row(s) report INVALID — re-auth or fix tokens per subaccount.`, tone: 'warn' });
      if (ghlBreakdown.error > 0) flags.push({ text: `${ghlBreakdown.error} GHL row(s) in ERROR — check connection health.`, tone: 'warn' });
      if (ghlBreakdown.fetchFailed > 0)
        flags.push({ text: `${ghlBreakdown.fetchFailed} GHL status fetch(es) failed — some rows unknown.`, tone: 'warn' });
    }
    if (withoutLocationId != null && withoutLocationId > 0)
      flags.push({
        text: `${withoutLocationId} subaccount(s) have no GHL location id on file — set location in GHL setup before expecting routing.`,
        tone: 'warn',
      });
    if (flags.length === 0 && !snapshotLoading && !err) {
      return [{ text: 'No issues flagged from the loaded metrics.', tone: 'ok' as const }];
    }
    return flags;
  }, [aiSnap, ghlBreakdown, withoutLocationId, snapshotLoading, err, lowQuota]);

  const ghlDrift = ghlBreakdown
    ? ghlBreakdown.connected < (tenantCount ?? 0)
    : false;

  return (
    <div>
      <PageHeader title="Control room" eyebrow="Agency account" />
      {agencyName ? (
        <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.6rem' }}>{agencyName}</p>
      ) : null}
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

      <div
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          marginBottom: '1.15rem',
        }}
      >
        <SectionCard title="Subaccounts & GHL location" subtitle="Count and GHL location id coverage.">
          {snapshotLoading && tenantCount === null ? (
            <LoadingBlock message="Loading…" />
          ) : (
            <KeyValueRows
              rows={[
                { label: 'Subaccounts in agency', value: String(tenantCount ?? '—') },
                { label: 'GHL location id on file', value: `${withGhlLocationId ?? '—'} / ${tenantCount ?? '—'}` },
                {
                  label: 'Missing location id',
                  value:
                    withoutLocationId != null && withoutLocationId > 0 ? (
                      <StatusPill label={`${withoutLocationId} subaccount(s)`} tone="warn" />
                    ) : (
                      <StatusPill label="None" tone="ok" />
                    ),
                },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="GHL" subtitle="Per-subaccount /connection read.">
          {snapshotLoading && ghlBreakdown === null ? (
            <LoadingBlock message="Loading GHL…" />
          ) : ghlBreakdown && tenantCount != null && tenantCount > 0 ? (
            <KeyValueRows
              rows={[
                { label: 'CONNECTED', value: <StatusPill label={String(ghlBreakdown.connected)} tone="ok" /> },
                { label: 'INVALID', value: <StatusPill label={String(ghlBreakdown.invalid)} tone={ghlBreakdown.invalid ? 'warn' : 'ok'} /> },
                { label: 'ERROR', value: <StatusPill label={String(ghlBreakdown.error)} tone={ghlBreakdown.error ? 'warn' : 'ok'} /> },
                { label: 'DISCONNECTED', value: String(ghlBreakdown.disconnected) },
                { label: 'Could not read row', value: <StatusPill label={String(ghlBreakdown.fetchFailed)} tone={ghlBreakdown.fetchFailed ? 'warn' : 'ok'} /> },
                {
                  label: 'Drift',
                  value: ghlDrift ? (
                    <StatusPill label="Connected < subaccounts" tone="warn" />
                  ) : (
                    <StatusPill label="Connected covers fleet" tone="ok" />
                  ),
                },
              ]}
            />
          ) : (
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>No subaccounts to evaluate.</p>
          )}
        </SectionCard>

        <SectionCard title="Live AI" subtitle="Active provider and model for generation.">
          {snapshotLoading && aiSnap === null && !err ? (
            <LoadingBlock message="Loading…" />
          ) : aiSnap ? (
            <KeyValueRows
              rows={[
                {
                  label: 'Keys',
                  value: <StatusPill label={aiSnap.hasKey ? 'Saved' : 'Not set'} tone={aiSnap.hasKey ? 'ok' : 'warn'} />,
                },
                { label: 'Active provider', value: aiSnap.provider, mono: true },
                { label: 'Active model', value: aiSnap.model, mono: true },
              ]}
            />
          ) : (
            <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>AI summary not loaded.</p>
          )}
          <p style={{ margin: '0.6rem 0 0' }}>
            <Link href="/app/agency/settings/ai" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
              Open AI &amp; models →
            </Link>
          </p>
        </SectionCard>

        <SectionCard title="Usage / quota" subtitle="Credits summed across the same /quota calls as the Usage tab.">
          {snapshotLoading && !usageAgg && !err ? (
            <LoadingBlock message="Loading quotas…" />
          ) : usageAgg ? (
            <>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>Subaccounts with quota: {usageAgg.subaccountsWithQuota}</p>
              <p style={{ fontWeight: 800, fontSize: '1.4rem', margin: '0.4rem 0 0.15rem', color: '#0f172a' }}>
                {fmtCompact(usageAgg.usedSum)} <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '1.05rem' }}>/</span>{' '}
                {fmtCompact(usageAgg.totalSum)}
              </p>
              {usagePct != null && usageAgg.totalSum > 0 ? (
                <div style={{ marginTop: '0.5rem' }}>
                  <div
                    style={{
                      height: '7px',
                      borderRadius: '4px',
                      background: '#e2e8f0',
                      overflow: 'hidden',
                    }}
                    aria-label={`${usagePct}% of combined cap used`}
                  >
                    <div
                      style={{
                        width: `${usagePct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #38bdf8, #2563eb)',
                      }}
                    />
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#475569', margin: '0.3rem 0 0' }}>≈ {usagePct}% of combined cap</p>
                </div>
              ) : null}
              {usageAgg.periodNote ? (
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.5rem 0 0' }}>{usageAgg.periodNote}</p>
              ) : null}
            </>
          ) : null}
        </SectionCard>
      </div>

      {lowQuota.length > 0 ? (
        <SectionCard title="Low quota" subtitle="Subaccounts under 15% of period cap.">
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', lineHeight: 1.6 }}>
            {lowQuota.map(l => (
              <li key={l.id} style={{ marginBottom: '0.35rem' }}>
                <Link href={`/app/tenant/${l.id}/usage`} style={{ fontWeight: 600, color: '#1d4ed8' }}>
                  {l.name}
                </Link>
                {` — ${l.remaining.toLocaleString()} / ${l.total.toLocaleString()} left`}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Recent changes"
        subtitle="Stored in the database audit log (see coverage note below). Not all agency actions are logged yet."
      >
        {recentAudit.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>No events yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.82rem', lineHeight: 1.55, color: '#334155' }}>
            {recentAudit.map(row => (
              <li key={row.id} style={{ marginBottom: '0.35rem' }}>
                <span style={{ color: '#94a3b8' }}>
                  {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                </span>
                {` — ${formatAuditDescription(row)}`}
                {row.actorEmail ? <span style={{ color: '#64748b' }}> — {row.actorEmail}</span> : null}
                {row.action === 'subaccount.topup' && row.tenant_id ? (
                  <span style={{ color: '#94a3b8' }}> (subaccount event)</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.5, margin: '0.65rem 0 0' }}>
          <strong style={{ color: '#64748b' }}>Logged here:</strong> subaccount create / rename / remove, default quota, quota
          top-ups, agency AI settings (including key rotation flags), live provider changes via “active provider”, and
          subaccount governance (reply policy limits). <strong style={{ color: '#64748b' }}>Not logged yet:</strong> GHL token
          or connection changes, and master prompt edits (no dedicated audit event).
        </p>
        <p style={{ margin: '0.6rem 0 0' }}>
          <Link href="/app/agency/settings/quotas" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
            Full audit →
          </Link>
        </p>
      </SectionCard>

      <SectionCard title="Attention" subtitle="Heuristics on current snapshot.">
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', lineHeight: 1.6, color: '#334155' }}>
          {operationalFlags.map((f, i) => (
            <li key={i} style={{ marginBottom: i < operationalFlags.length - 1 ? '0.45rem' : 0 }}>
              <span style={{ color: f.tone === 'warn' ? '#b45309' : '#166534' }}>● </span>
              {f.text}
            </li>
          ))}
        </ul>
      </SectionCard>

      <div style={{ marginTop: '1.1rem', display: 'grid', gap: '1rem' }}>
        <SectionCard title="Shortcuts" subtitle="After reviewing metrics above.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem 1rem', fontSize: '0.82rem', fontWeight: 600 }}>
            <Link href="/app/agency/tenants" style={{ color: '#1d4ed8', textDecoration: 'none' }}>
              Subaccounts
            </Link>
            <Link href="/app/agency/settings/ai" style={{ color: '#1d4ed8', textDecoration: 'none' }}>
              AI &amp; models
            </Link>
            <Link href="/app/agency/settings/quotas" style={{ color: '#1d4ed8', textDecoration: 'none' }}>
              Quotas
            </Link>
            <Link href="/app/agency/settings/ghl" style={{ color: '#1d4ed8', textDecoration: 'none' }}>
              GHL
            </Link>
            <Link href="/app/agency/settings/policies" style={{ color: '#1d4ed8', textDecoration: 'none' }}>
              Master Prompt
            </Link>
            <Link href="/app/agency/team" style={{ color: '#1d4ed8', textDecoration: 'none' }}>
              Agency team
            </Link>
            {firstTenantId ? (
              <Link href={`/app/tenant/${firstTenantId}/usage`} style={{ color: '#1d4ed8', textDecoration: 'none' }}>
                Open usage (subaccount)
              </Link>
            ) : null}
          </div>
        </SectionCard>
        <SectionCard title="Session" subtitle="Signed in user.">
          <KeyValueRows
            rows={[
              { label: 'Agency account', value: agencyName ?? (snapshotLoading ? '…' : '—') },
              { label: 'Signed in as', value: user?.email ?? '—' },
              { label: 'Role', value: <StatusPill label={role ?? '—'} tone="neutral" /> },
            ]}
          />
        </SectionCard>
      </div>
    </div>
  );
}
