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
  appFloatingSecondaryButtonStyle,
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
    return `Workspace created: ${String(m['name'])}`;
  }
  if (a === 'subaccount.renamed' && m?.['previousName'] && m?.['newName']) {
    return `Workspace renamed: ${String(m['previousName'])} → ${String(m['newName'])}`;
  }
  if (a === 'subaccount.deleted' && m?.['name']) {
    return `Workspace removed: ${String(m['name'])}`;
  }
  if (a === 'agency.ai_settings' && m) {
    const p = m['provider'];
    const k = m['keyRotated'];
    const sa = m['setAsActive'];
    const am = m['defaultModel'];
    return `AI provider updated: ${p ?? '—'}${am ? `, model ${am}` : ''}${
      sa ? ', set as live provider' : ''
    }${k ? ', API key updated' : ''}`;
  }
  if (a === 'agency.active_provider' && m?.['newActiveProvider']) {
    return `Live AI provider changed: ${String(m['previousActiveProvider'] ?? '—')} → ${String(m['newActiveProvider'])}`;
  }
  if (a === 'agency.reply_policy') {
    return 'Workspace reply limits updated';
  }
  if (a === 'agency.default_quota') {
    return `Default credits: ${row.previous_total ?? '—'} → ${row.new_total ?? '—'}`;
  }
  if (a === 'subaccount.topup') {
    return `Workspace credits topped up (${row.previous_total ?? '—'} → ${row.new_total ?? '—'})`;
  }
  return 'Activity recorded';
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
                ? 'Billing windows differ by workspace; treat this total as a guide.'
                : ok.length
                  ? null
                  : 'No credit records were found for these workspaces.',
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
      flags.push({ text: 'AI provider needs setup before live replies can be generated.', tone: 'warn' });
    if (lowQuota.length > 0)
      flags.push({
        text: `${lowQuota.length} workspace(s) are below 15% remaining credits: ${lowQuota
          .slice(0, 3)
          .map(l => l.name)
          .join(', ')}${lowQuota.length > 3 ? '…' : ''}.`,
        tone: 'warn',
      });
    if (ghlBreakdown) {
      if (ghlBreakdown.invalid > 0)
        flags.push({ text: `${ghlBreakdown.invalid} HighLevel connection(s) need a new token or location check.`, tone: 'warn' });
      if (ghlBreakdown.error > 0) flags.push({ text: `${ghlBreakdown.error} HighLevel connection(s) need review.`, tone: 'warn' });
      if (ghlBreakdown.fetchFailed > 0)
        flags.push({ text: `${ghlBreakdown.fetchFailed} HighLevel status check(s) could not be loaded.`, tone: 'warn' });
    }
    if (withoutLocationId != null && withoutLocationId > 0)
      flags.push({
        text: `${withoutLocationId} workspace(s) need a HighLevel location ID before routing can work.`,
        tone: 'warn',
      });
    if (flags.length === 0 && !snapshotLoading && !err) {
      return [{ text: 'Everything important looks ready from the latest snapshot.', tone: 'ok' as const }];
    }
    return flags;
  }, [aiSnap, ghlBreakdown, withoutLocationId, snapshotLoading, err, lowQuota]);

  const ghlDrift = ghlBreakdown
    ? ghlBreakdown.connected < (tenantCount ?? 0)
    : false;

  return (
    <div>
      <PageHeader title="Control Center" eyebrow="Agency account" />
      {agencyName ? (
        <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.6rem' }}>{agencyName}</p>
      ) : null}
      <p style={{ fontSize: '0.9rem', color: '#64748b', margin: '0 0 1.1rem', lineHeight: 1.5, maxWidth: '42rem' }}>
        Monitor client workspaces, HighLevel connections, AI provider status, credits, and recent activity.
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

      <div
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          marginBottom: '1.15rem',
        }}
      >
        <SectionCard title="Workspaces" subtitle="Client workspaces connected to this agency.">
          {snapshotLoading && tenantCount === null ? (
            <LoadingBlock message="Loading…" />
          ) : (
            <KeyValueRows
              rows={[
                { label: 'Total workspaces', value: String(tenantCount ?? '—') },
                { label: 'HighLevel IDs saved', value: `${withGhlLocationId ?? '—'} / ${tenantCount ?? '—'}` },
                {
                  label: 'Needs setup',
                  value:
                    withoutLocationId != null && withoutLocationId > 0 ? (
                      <StatusPill label={`${withoutLocationId} workspace(s)`} tone="warn" />
                    ) : (
                      <StatusPill label="None" tone="ok" />
                    ),
                },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="HighLevel Connections" subtitle="Connection health across client workspaces.">
          {snapshotLoading && ghlBreakdown === null ? (
            <LoadingBlock message="Loading HighLevel…" />
          ) : ghlBreakdown && tenantCount != null && tenantCount > 0 ? (
            <KeyValueRows
              rows={[
                { label: 'Connected', value: <StatusPill label={String(ghlBreakdown.connected)} tone="ok" /> },
                { label: 'Needs token check', value: <StatusPill label={String(ghlBreakdown.invalid)} tone={ghlBreakdown.invalid ? 'warn' : 'ok'} /> },
                { label: 'Needs review', value: <StatusPill label={String(ghlBreakdown.error)} tone={ghlBreakdown.error ? 'warn' : 'ok'} /> },
                { label: 'Needs setup', value: String(ghlBreakdown.disconnected) },
                { label: 'Status unavailable', value: <StatusPill label={String(ghlBreakdown.fetchFailed)} tone={ghlBreakdown.fetchFailed ? 'warn' : 'ok'} /> },
                {
                  label: 'Coverage',
                  value: ghlDrift ? (
                    <StatusPill label="Some workspaces need setup" tone="warn" />
                  ) : (
                    <StatusPill label="All set" tone="ok" />
                  ),
                },
              ]}
            />
          ) : (
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>No workspaces to evaluate yet.</p>
          )}
        </SectionCard>

        <SectionCard title="Live AI" subtitle="Provider and model used for generated replies.">
          {snapshotLoading && aiSnap === null && !err ? (
            <LoadingBlock message="Loading…" />
          ) : aiSnap ? (
            <KeyValueRows
              rows={[
                {
                  label: 'Keys',
                  value: <StatusPill label={aiSnap.hasKey ? 'Saved' : 'Not set'} tone={aiSnap.hasKey ? 'ok' : 'warn'} />,
                },
                { label: 'Provider', value: aiSnap.provider, mono: true },
                { label: 'Model', value: aiSnap.model, mono: true },
              ]}
            />
          ) : (
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>AI provider summary is not loaded.</p>
          )}
          <div style={{ margin: '0.75rem 0 0' }}>
            <Link href="/app/agency/settings/ai" style={appFloatingSecondaryButtonStyle}>
              Manage AI provider
            </Link>
          </div>
        </SectionCard>

        <SectionCard title="Credits" subtitle="Credit usage across client workspaces.">
          {snapshotLoading && !usageAgg && !err ? (
            <LoadingBlock message="Loading credits…" />
          ) : usageAgg ? (
            <>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>Workspaces with credits: {usageAgg.subaccountsWithQuota}</p>
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
                  <p style={{ fontSize: '0.8rem', color: '#475569', margin: '0.3rem 0 0' }}>≈ {usagePct}% used</p>
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
        <SectionCard title="Low credits" subtitle="Workspaces under 15% remaining credits.">
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', lineHeight: 1.6 }}>
            {lowQuota.map(l => (
              <li key={l.id} style={{ marginBottom: '0.35rem' }}>
                <Link href={`/app/tenant/${l.id}/usage`} style={appFloatingSecondaryButtonStyle}>
                  {l.name}
                </Link>
                {` — ${l.remaining.toLocaleString()} / ${l.total.toLocaleString()} left`}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard title="Recent activity" subtitle="Recent setup and credit changes for this agency.">
        {recentAudit.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>No activity yet.</p>
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
                  <span style={{ color: '#94a3b8' }}> (workspace event)</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <details style={{ marginTop: '0.7rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Support details</summary>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.5, margin: '0.5rem 0 0' }}>
            This activity list currently includes workspace create / rename / remove, default credits, credit top-ups, AI provider
            settings, live provider changes, and workspace reply limits.
          </p>
        </details>
        <div style={{ margin: '0.75rem 0 0' }}>
          <Link href="/app/agency/settings/quotas" style={appFloatingSecondaryButtonStyle}>
            View credits activity
          </Link>
        </div>
      </SectionCard>

      <SectionCard title="Needs attention" subtitle="Recommended next steps from the latest snapshot.">
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
        <SectionCard title="Quick actions" subtitle="Common setup tasks.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <Link href="/app/agency/tenants" style={appFloatingSecondaryButtonStyle}>
              Client Workspaces
            </Link>
            <Link href="/app/agency/settings/ai" style={appFloatingSecondaryButtonStyle}>
              AI Provider
            </Link>
            <Link href="/app/agency/settings/quotas" style={appFloatingSecondaryButtonStyle}>
              Credits
            </Link>
            <Link href="/app/agency/settings/ghl" style={appFloatingSecondaryButtonStyle}>
              HighLevel
            </Link>
            <Link href="/app/agency/settings/policies" style={appFloatingSecondaryButtonStyle}>
              Global Prompt
            </Link>
            <Link href="/app/agency/team" style={appFloatingSecondaryButtonStyle}>
              Team
            </Link>
            {firstTenantId ? (
              <Link href={`/app/tenant/${firstTenantId}/usage`} style={appFloatingSecondaryButtonStyle}>
                Open workspace usage
              </Link>
            ) : null}
          </div>
        </SectionCard>
        <SectionCard title="Account" subtitle="Signed-in user.">
          <KeyValueRows
            rows={[
              { label: 'Agency', value: agencyName ?? (snapshotLoading ? '…' : '—') },
              { label: 'Signed in as', value: user?.email ?? '—' },
              { label: 'Role', value: <StatusPill label={role ?? '—'} tone="neutral" /> },
            ]}
          />
        </SectionCard>
      </div>
    </div>
  );
}
