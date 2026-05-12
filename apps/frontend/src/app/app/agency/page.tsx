'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  type ActiveAiHealthBadge,
  type GhlConnectionStatus,
  getAgencyAiConfig,
  getAgencyById,
  getCurrentUser,
  getGhlConnection,
  getTenantQuota,
  getTenantsByAgency,
} from '@/lib/api';
import {
  ErrorBanner,
  LoadingBlock,
  SectionCard,
  StatusPill,
  appFloatingSecondaryButtonStyle,
  formatDateTime,
} from '@/components/app/mvp-ui';
import { formatWorkspaceDisplayName } from '@/lib/workspace-display';

function fmtCompact(n: number) {
  return n.toLocaleString();
}

type GhlBreakdown = {
  connected: number;
  invalid: number;
  error: number;
  disconnected: number;
  fetchFailed: number;
};

type WorkspaceDetailRow = {
  id: string;
  name: string;
  isAgencyWorkspace?: boolean;
  ghlLocationId?: string | null;
  ghl: GhlConnectionStatus | null;
  quota: {
    totalQuota: number;
    usedQuota: number;
    remainingQuota: number;
  } | null;
};

const kpiCardShell: CSSProperties = {
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  borderRadius: '14px',
  padding: '1.25rem 1.35rem',
  background: 'var(--aisbp-surface, #ffffff)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  minHeight: '168px',
};

const kpiTitle: CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--aisbp-muted, #94a3b8)',
  margin: 0,
};

const kpiFigure: CSSProperties = {
  fontSize: '2.15rem',
  fontWeight: 800,
  letterSpacing: '-0.03em',
  lineHeight: 1.05,
  color: 'var(--aisbp-text-heading, #0f172a)',
  margin: '0.15rem 0 0',
};

const kpiMuted: CSSProperties = {
  fontSize: '0.82rem',
  color: 'var(--aisbp-muted, #64748b)',
  lineHeight: 1.45,
  margin: 0,
};

export default function AgencyHomePage() {
  const { token, user } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [, setRole] = useState<string | null>(null);
  const [tenantCount, setTenantCount] = useState<number | null>(null);
  const [withGhlLocationId, setWithGhlLocationId] = useState<number | null>(null);
  const [ghlBreakdown, setGhlBreakdown] = useState<GhlBreakdown | null>(null);
  const [ghlConnectedCount, setGhlConnectedCount] = useState<number | null>(null);
  const [aiSnap, setAiSnap] = useState<{
    hasKey: boolean;
    provider: string;
    model: string;
    healthBadge: ActiveAiHealthBadge;
    lastChecked: string | null;
    latencyMs: number | null;
    healthError: string | null;
  } | null>(null);
  const [usageAgg, setUsageAgg] = useState<{
    subaccountsWithQuota: number;
    usedSum: number;
    totalSum: number;
    periodNote: string | null;
  } | null>(null);
  const [workspaceDetails, setWorkspaceDetails] = useState<WorkspaceDetailRow[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const agencyId = user?.agencyId;
    if (!token || !agencyId) return;
    let cancelled = false;
    (async () => {
      setSnapshotLoading(true);
      setErr('');
      try {
        const [me, agency, tenants, ai] = await Promise.all([
          getCurrentUser(token),
          getAgencyById(token, agencyId),
          getTenantsByAgency(token, agencyId),
          getAgencyAiConfig(token).catch(() => null),
        ]);
        if (cancelled) return;
        setRole(me.agencyRole ?? null);
        setAgencyName(agency?.name ?? agencyId);
        const tlist = Array.isArray(tenants) ? tenants : [];
        setTenantCount(tlist.length);
        setWithGhlLocationId(tlist.filter(t => t.ghlLocationId && String(t.ghlLocationId).trim() !== '').length);
        if (ai) {
          const ap = ai.activeProvider ?? ai.provider;
          const hasKey = Boolean((ap && ai.keysPresent?.[ap]) ?? ai.hasApiKey);
          const ah = ai.activeAiHealth ?? {
            healthBadge: 'UNKNOWN' as const,
            lastHealthCheckedAt: null,
            lastHealthLatencyMs: null,
            lastHealthErrorSummary: null,
          };
          setAiSnap({
            hasKey,
            provider: ap || '—',
            model: ai.activeModel ?? (ai.defaultModel || '—'),
            healthBadge: ah.healthBadge,
            lastChecked: ah.lastHealthCheckedAt,
            latencyMs: ah.lastHealthLatencyMs,
            healthError: ah.lastHealthErrorSummary,
          });
        } else {
          setAiSnap(null);
        }

        if (tlist.length === 0) {
          setGhlBreakdown({ connected: 0, invalid: 0, error: 0, disconnected: 0, fetchFailed: 0 });
          setGhlConnectedCount(0);
          setUsageAgg({ subaccountsWithQuota: 0, usedSum: 0, totalSum: 0, periodNote: null });
          setWorkspaceDetails([]);
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
                ? 'Billing periods differ by workspace; combined totals are approximate.'
                : ok.length
                  ? null
                  : 'No credit records were found for these workspaces.',
          });
          setWorkspaceDetails(
            tlist.map((t, i) => ({
              id: t.id,
              name: t.name,
              isAgencyWorkspace: Boolean(t.isAgencyWorkspace),
              ghlLocationId: t.ghlLocationId,
              ghl: ghlRows[i] ?? null,
              quota: qRows[i] ?? null,
            })),
          );
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

  const aiHealthPill = (b: ActiveAiHealthBadge) => {
    if (b === 'PASS') return <StatusPill label="Working" tone="ok" />;
    if (b === 'FAIL') return <StatusPill label="Needs attention" tone="bad" />;
    return <StatusPill label="Not tested" tone="neutral" />;
  };

  const readinessRows = useMemo(() => {
    const aiBlocking =
      aiSnap != null && (!aiSnap.hasKey || aiSnap.healthBadge === 'FAIL');

    return workspaceDetails
      .map(row => {
        const hasLoc = Boolean(row.ghlLocationId && String(row.ghlLocationId).trim());
        const g = row.ghl;
        const crmConnected = Boolean(g?.connected && g.status === 'CONNECTED');
        const crmBad = !hasLoc || !crmConnected;
        const q = row.quota;
        const creditLow = Boolean(q && q.totalQuota > 0 && q.remainingQuota / q.totalQuota < 0.15);
        const needsAttention = crmBad || creditLow || aiBlocking;
        if (!needsAttention) return null;

        let crmPill: React.ReactNode;
        if (!hasLoc) {
          crmPill = <StatusPill label="Not linked" tone="warn" />;
        } else if (!g) {
          crmPill = <StatusPill label="Status unavailable" tone="warn" />;
        } else if (crmConnected) {
          crmPill = <StatusPill label="Connected" tone="ok" />;
        } else if (g.status === 'DISCONNECTED') {
          crmPill = <StatusPill label="Needs setup" tone="warn" />;
        } else if (g.status === 'INVALID') {
          crmPill = <StatusPill label="Reconnect CRM" tone="warn" />;
        } else {
          crmPill = <StatusPill label="Needs review" tone="bad" />;
        }

        let aiPill: JSX.Element;
        if (!aiSnap) {
          aiPill = <StatusPill label="—" tone="neutral" />;
        } else if (!aiSnap.hasKey) {
          aiPill = <StatusPill label="Not connected" tone="warn" />;
        } else if (aiSnap.healthBadge === 'FAIL') {
          aiPill = <StatusPill label="Needs attention" tone="bad" />;
        } else {
          aiPill = <StatusPill label="Ready" tone="ok" />;
        }

        const creditsCell =
          q && q.totalQuota > 0 ? (
            <span style={{ fontSize: '0.84rem', color: 'var(--aisbp-text-secondary, #334155)' }}>
              {fmtCompact(q.usedQuota)} / {fmtCompact(q.totalQuota)}
              {creditLow ? (
                <span style={{ display: 'block', marginTop: '0.25rem' }}>
                  <StatusPill label="Running low" tone="warn" />
                </span>
              ) : null}
            </span>
          ) : (
            <span style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #94a3b8)' }}>—</span>
          );

        const statusParts: string[] = [];
        if (crmBad) statusParts.push('CRM Connection');
        if (creditLow) statusParts.push('Credits');
        if (aiBlocking) statusParts.push('AI');
        const statusSummary = statusParts.join(' · ');

        return (
          <tr
            key={row.id}
            style={{
              borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
              verticalAlign: 'middle',
              background: 'var(--aisbp-table-row-bg, #fff)',
            }}
          >
            <td style={{ padding: '0.85rem 0.65rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>
              {formatWorkspaceDisplayName({
                name: row.name,
                id: row.id,
                isAgencyWorkspace: row.isAgencyWorkspace,
              })}
            </td>
            <td style={{ padding: '0.85rem 0.65rem' }}>{crmPill}</td>
            <td style={{ padding: '0.85rem 0.65rem' }}>{aiPill}</td>
            <td style={{ padding: '0.85rem 0.65rem' }}>{creditsCell}</td>
            <td style={{ padding: '0.85rem 0.65rem', fontSize: '0.82rem', color: 'var(--aisbp-text-secondary, #475569)' }}>
              {statusSummary}
            </td>
            <td style={{ padding: '0.85rem 0.65rem' }}>
              <Link href={`/app/tenant/${row.id}`} style={appFloatingSecondaryButtonStyle}>
                Open workspace
              </Link>
            </td>
          </tr>
        );
      })
      .filter((row): row is JSX.Element => row !== null);
  }, [workspaceDetails, aiSnap]);

  const ghlDrift = ghlBreakdown ? ghlBreakdown.connected < (tenantCount ?? 0) : false;

  return (
    <div>
      <header style={{ marginBottom: '1.75rem' }}>
        <p
          style={{
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--aisbp-muted, #94a3b8)',
            margin: '0 0 0.5rem',
            fontWeight: 700,
          }}
        >
          Agency account
        </p>
        <h1
          style={{
            fontSize: '1.85rem',
            fontWeight: 800,
            margin: '0 0 0.5rem',
            lineHeight: 1.15,
            color: 'var(--aisbp-text-heading, #0f172a)',
            letterSpacing: '-0.03em',
          }}
        >
          Dashboard
        </h1>
        <p
          style={{
            fontSize: '0.95rem',
            color: 'var(--aisbp-muted, #64748b)',
            margin: 0,
            lineHeight: 1.55,
            maxWidth: '40rem',
          }}
        >
          Monitor workspace health, CRM connections, AI readiness, and credit usage across your agency.
        </p>
        {agencyName ? (
          <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text-secondary, #475569)', margin: '0.65rem 0 0', fontWeight: 600 }}>
            {agencyName}
            <span style={{ fontWeight: 500, color: 'var(--aisbp-muted, #94a3b8)' }}> · Signed in as {user?.email ?? '—'}</span>
          </p>
        ) : null}
      </header>

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
              border: '1px solid var(--aisbp-border-strong, #cbd5e1)',
              background: 'var(--aisbp-surface, #fff)',
              color: 'var(--aisbp-text-secondary, #334155)',
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
          gap: '1.1rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          marginBottom: '1.5rem',
        }}
      >
        <section style={kpiCardShell}>
          <p style={kpiTitle}>Workspaces</p>
          {snapshotLoading && tenantCount === null ? (
            <LoadingBlock message="Loading…" />
          ) : (
            <>
              <p style={kpiFigure}>{tenantCount ?? '—'}</p>
              <p style={kpiMuted}>Client workspaces on this agency account.</p>
              <p style={{ ...kpiMuted, marginTop: 'auto', paddingTop: '0.35rem' }}>
                <span style={{ fontWeight: 600, color: 'var(--aisbp-text-secondary, #475569)' }}>
                  {withGhlLocationId ?? '—'} with CRM location saved
                </span>
              </p>
            </>
          )}
        </section>

        <section style={kpiCardShell}>
          <p style={kpiTitle}>CRM Connections</p>
          {snapshotLoading && ghlBreakdown === null ? (
            <LoadingBlock message="Loading…" />
          ) : ghlBreakdown && tenantCount != null && tenantCount > 0 ? (
            <>
              <p style={kpiFigure}>
                {ghlConnectedCount ?? 0}
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', marginLeft: '0.15rem' }}> / {tenantCount}</span>
              </p>
              <p style={kpiMuted}>Workspaces with a healthy CRM link.</p>
              <div style={{ marginTop: 'auto', paddingTop: '0.35rem' }}>
                {ghlDrift ? (
                  <StatusPill label="Some workspaces need attention" tone="warn" />
                ) : (
                  <StatusPill label="All connected workspaces look healthy" tone="ok" />
                )}
              </div>
            </>
          ) : (
            <>
              <p style={kpiFigure}>0</p>
              <p style={kpiMuted}>Add a workspace to start connecting CRM.</p>
            </>
          )}
        </section>

        <section style={kpiCardShell}>
          <p style={kpiTitle}>Live AI</p>
          {snapshotLoading && aiSnap === null && !err ? (
            <LoadingBlock message="Loading…" />
          ) : aiSnap ? (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem', minHeight: '2.6rem' }}>
                {!aiSnap.hasKey ? (
                  <StatusPill label="Not connected" tone="warn" />
                ) : (
                  <StatusPill label="AI service connected" tone="ok" />
                )}
                {aiSnap.hasKey ? aiHealthPill(aiSnap.healthBadge) : null}
              </div>
              <p style={{ ...kpiMuted, marginTop: '0.15rem' }}>
                {!aiSnap.hasKey
                  ? 'Connect an AI provider to generate replies.'
                  : aiSnap.healthBadge === 'UNKNOWN'
                    ? 'Run a quick check from AI settings when you are ready.'
                    : aiSnap.healthBadge === 'FAIL'
                      ? 'Recent checks reported an issue. Review settings or try again.'
                      : 'Latest check completed successfully.'}
              </p>
              {aiSnap.hasKey && aiSnap.latencyMs != null && aiSnap.healthBadge !== 'UNKNOWN' ? (
                <p style={{ fontSize: '0.88rem', fontWeight: 650, color: 'var(--aisbp-text-heading, #0f172a)', margin: 0 }}>
                  Response time · {aiSnap.latencyMs} ms
                </p>
              ) : null}
              <details style={{ marginTop: '0.35rem' }}>
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    color: 'var(--aisbp-muted, #64748b)',
                    listStyle: 'none',
                  }}
                >
                  Support details
                </summary>
                <p style={{ margin: '0.45rem 0 0', fontSize: '0.8rem', color: 'var(--aisbp-text-secondary, #334155)', lineHeight: 1.45 }}>
                  Provider and model are managed in AI settings.
                  <span style={{ display: 'block', marginTop: '0.35rem', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>
                    {aiSnap.provider} · {aiSnap.model}
                  </span>
                  {aiSnap.lastChecked && aiSnap.healthBadge !== 'UNKNOWN' ? (
                    <span style={{ display: 'block', marginTop: '0.35rem', color: 'var(--aisbp-muted, #64748b)' }}>
                      Last checked {formatDateTime(aiSnap.lastChecked)}
                    </span>
                  ) : null}
                </p>
              </details>
              {aiSnap.healthBadge === 'FAIL' && aiSnap.healthError ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-pill-warn-fg, #b45309)', margin: '0.5rem 0 0', lineHeight: 1.45 }}>
                  {aiSnap.healthError}
                </p>
              ) : null}
              <div style={{ marginTop: 'auto', paddingTop: '0.65rem' }}>
                <Link href="/app/agency/settings/ai" style={appFloatingSecondaryButtonStyle}>
                  Manage AI connection
                </Link>
              </div>
            </>
          ) : (
            <>
              <p style={kpiMuted}>AI summary could not be loaded.</p>
              <div style={{ marginTop: 'auto' }}>
                <Link href="/app/agency/settings/ai" style={appFloatingSecondaryButtonStyle}>
                  Manage AI connection
                </Link>
              </div>
            </>
          )}
        </section>

        <section style={kpiCardShell}>
          <p style={kpiTitle}>Credits</p>
          {snapshotLoading && !usageAgg && !err ? (
            <LoadingBlock message="Loading…" />
          ) : usageAgg ? (
            <>
              <p style={{ ...kpiFigure, fontSize: '1.65rem' }}>
                {fmtCompact(usageAgg.usedSum)}{' '}
                <span style={{ color: 'var(--aisbp-muted, #94a3b8)', fontWeight: 700, fontSize: '1.15rem' }}>/</span>{' '}
                {fmtCompact(usageAgg.totalSum)}
              </p>
              <p style={kpiMuted}>Used and available credits across workspaces that have balances.</p>
              {usagePct != null && usageAgg.totalSum > 0 ? (
                <div style={{ marginTop: '0.35rem' }}>
                  <div
                    style={{
                      height: '8px',
                      borderRadius: '6px',
                      background: '#e8edf3',
                      overflow: 'hidden',
                    }}
                    aria-label={`${usagePct}% used`}
                  >
                    <div
                      style={{
                        width: `${usagePct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #38bdf8, #2563eb)',
                        borderRadius: '6px',
                      }}
                    />
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0.4rem 0 0' }}>{usagePct}% used</p>
                </div>
              ) : (
                <p style={{ ...kpiMuted, marginTop: '0.35rem' }}>No combined balance to display yet.</p>
              )}
              {usageAgg.periodNote ? (
                <p style={{ fontSize: '0.76rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0.45rem 0 0', lineHeight: 1.4 }}>{usageAgg.periodNote}</p>
              ) : null}
              <div style={{ marginTop: 'auto', paddingTop: '0.65rem' }}>
                <Link href="/app/agency/settings/quotas" style={appFloatingSecondaryButtonStyle}>
                  Manage credits
                </Link>
              </div>
            </>
          ) : null}
        </section>
      </div>

      <SectionCard title="Workspace readiness" subtitle="Workspaces that may need setup or a quick review.">
        {snapshotLoading && workspaceDetails.length === 0 && tenantCount === null ? (
          <LoadingBlock message="Loading…" />
        ) : readinessRows.length === 0 ? (
          <div
            style={{
              padding: '1.35rem 1rem',
              borderRadius: '12px',
              background:
                'linear-gradient(180deg, var(--aisbp-card-gradient-top, #f8fafc) 0%, var(--aisbp-card-gradient-bottom, #f1f5f9) 100%)',
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              textAlign: 'center',
            }}
          >
            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)', margin: '0 0 0.35rem' }}>
              All key workspaces look ready.
            </p>
            <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #64748b)', margin: 0, lineHeight: 1.5 }}>
              CRM links, credits, and AI look fine from the latest snapshot. Check back after onboarding new clients.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: '720px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--aisbp-border, #e8edf3)' }}>
                  {['Workspace', 'CRM Connection', 'AI setup', 'Credits', 'Status', 'Action'].map(h => (
                    <th
                      key={h}
                      style={{
                        padding: '0.55rem 0.65rem',
                        fontWeight: 700,
                        fontSize: '0.72rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--aisbp-muted, #94a3b8)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{readinessRows}</tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
