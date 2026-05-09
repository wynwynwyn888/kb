'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getGhlConnection,
  saveGhlConnection,
  verifyGhlConnection,
  checkGhlHealth,
  deleteGhlConnection,
  getTenantsByAgency,
  type GhlConnectionStatus,
} from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  KeyValueRows,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  SuccessBanner,
  formatDateTime,
  mvpFieldHint,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpDangerButtonStyle,
} from '@/components/app/mvp-ui';
import { readAgencyWorkspaceSelection } from '@/lib/theme-preference';

type TenantOpt = { id: string; name: string; status: string; ghlLocationId?: string | null };

function ghlTone(s: GhlConnectionStatus['status']): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (s === 'CONNECTED') return 'ok';
  if (s === 'DISCONNECTED') return 'neutral';
  if (s === 'INVALID' || s === 'ERROR') return 'bad';
  return 'neutral';
}

function connectionSummaryPill(
  conn: GhlConnectionStatus | null,
  connLoading: boolean,
  selected: TenantOpt | undefined,
): { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' } | null {
  const hasLoc = Boolean(selected?.ghlLocationId && String(selected.ghlLocationId).trim());
  if (connLoading && !conn) return null;
  if (conn?.connected && conn.status === 'CONNECTED') return { label: 'Connected', tone: 'ok' };
  if (conn) {
    if (conn.status === 'INVALID') return { label: 'Reconnect required', tone: 'bad' };
    if (conn.status === 'ERROR') return { label: 'Needs review', tone: 'bad' };
    if (conn.status === 'DISCONNECTED') return { label: 'Not connected', tone: 'warn' };
    return { label: conn.status, tone: ghlTone(conn.status) };
  }
  if (hasLoc) return { label: 'Details saved', tone: 'neutral' };
  return { label: 'Needs CRM details', tone: 'warn' };
}

function AgencyGhlConnectionsInner() {
  const { token, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preTenant = searchParams.get('subaccount') ?? searchParams.get('tenant');

  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [tenantsErr, setTenantsErr] = useState('');
  const [tenantId, setTenantId] = useState(preTenant || '');
  const [conn, setConn] = useState<GhlConnectionStatus | null>(null);
  const [connLoading, setConnLoading] = useState(false);
  const [loc, setLoc] = useState('');
  const [pit, setPit] = useState('');
  const [health, setHealth] = useState<{ healthy: boolean; message: string; timestamp: string } | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!token || !user?.agencyId) return;
    let cancelled = false;
    setTenantsLoading(true);
    setTenantsErr('');
    getTenantsByAgency(token, user.agencyId)
      .then(t => {
        if (cancelled) return;
        const mapped: TenantOpt[] = t.map(x => ({
          id: x.id,
          name: x.name,
          status: x.status,
          ghlLocationId: x.ghlLocationId,
        }));
        setTenants(mapped);
      })
      .catch(e => {
        if (!cancelled) setTenantsErr(e instanceof Error ? e.message : 'Failed to load workspaces');
      })
      .finally(() => {
        if (!cancelled) setTenantsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user?.agencyId]);

  useEffect(() => {
    setTenantId(preTenant || '');
    setHealth(null);
    setMsg('');
    setErr('');
  }, [preTenant]);

  useEffect(() => {
    if (tenantsLoading || tenantsErr) return;
    if (tenants.length === 0) return;
    const hasValid = Boolean(tenantId && tenants.some(t => t.id === tenantId));
    if (hasValid) return;
    let pick: string | null = null;
    if (preTenant && tenants.some(t => t.id === preTenant)) {
      pick = preTenant;
    } else {
      const last = readAgencyWorkspaceSelection();
      if (last && tenants.some(t => t.id === last)) pick = last;
    }
    if (!pick) {
      const withLoc = tenants.find(t => t.ghlLocationId && String(t.ghlLocationId).trim());
      const fallback = tenants[0]?.id;
      if (!fallback) return;
      pick = withLoc?.id ?? fallback;
    }
    router.replace(`/app/agency/settings/ghl?subaccount=${encodeURIComponent(pick)}`);
  }, [tenantsLoading, tenantsErr, tenants, tenantId, preTenant, router]);

  const refreshConn = useCallback(async () => {
    if (!token || !tenantId) {
      setConn(null);
      return;
    }
    setConnLoading(true);
    try {
      const s = await getGhlConnection(token, tenantId);
      setConn(s);
      setLoc(prev => (prev.trim() === '' ? (s.ghlLocationId ?? '') : prev));
    } catch {
      setConn(null);
    } finally {
      setConnLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    refreshConn();
  }, [refreshConn]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !tenantId) return;
    setErr('');
    setMsg('');
    setSaving(true);
    try {
      await saveGhlConnection(token, tenantId, {
        ghlLocationId: loc.trim(),
        privateIntegrationToken: pit.trim(),
      });
      setMsg('CRM Connection saved.');
      setPit('');
      await refreshConn();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const onVerify = async () => {
    if (!token || !tenantId) return;
    setErr('');
    setMsg('');
    setVerifying(true);
    try {
      const s = await verifyGhlConnection(token, tenantId);
      await refreshConn();
      try {
        const h = await checkGhlHealth(token, tenantId);
        setHealth(h);
        if (h.healthy && s.connected) {
          setMsg('Connection verified and looks healthy.');
          setErr('');
        } else if (!h.healthy) {
          setMsg('');
          setErr(h.message || 'Connection check reported a problem. Try saving a new token or verify again.');
        } else {
          setMsg('');
          setErr(s.lastError?.trim() || 'CRM did not accept the saved token. Paste a new private integration token and save.');
        }
      } catch {
        setHealth(null);
        if (s.connected) {
          setMsg('Connection verified.');
          setErr('');
        } else {
          setMsg('');
          setErr(s.lastError?.trim() || 'CRM did not accept the saved token. Paste a new private integration token and save.');
        }
      }
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Verify failed');
    } finally {
      setVerifying(false);
    }
  };

  const onDisconnect = async () => {
    if (!token || !tenantId) return;
    if (!confirm('Disconnect CRM for this workspace?')) return;
    setErr('');
    setMsg('');
    setDisconnecting(true);
    try {
      await deleteGhlConnection(token, tenantId);
      setMsg('Disconnected.');
      await refreshConn();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  const selected = tenants.find(t => t.id === tenantId);
  const unknownTenant = Boolean(tenantId && !tenantsLoading && tenants.length > 0 && !selected);

  return (
    <div>
      <PageHeader title="CRM Connection" eyebrow="Agency account" />
      <p style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 1rem', maxWidth: '32rem' }}>
        Connect one client workspace to CRM so AISalesBot Pro can read and send conversation data.
      </p>

      {err && <ErrorBanner message={err} />}
      {msg && <SuccessBanner message={msg} />}

      {tenantsLoading ? <LoadingBlock message="Loading workspaces…" /> : null}
      {!tenantsLoading && tenantsErr ? <ErrorBanner message={tenantsErr} /> : null}
      {!tenantsLoading && !tenantsErr && tenants.length === 0 ? (
        <EmptyState title="No workspaces" detail="Create a client workspace first, then connect CRM." />
      ) : null}

      {unknownTenant ? <ErrorBanner message="That workspace is not in this agency. Choose another workspace." /> : null}

      {!tenantsLoading && !tenantsErr && tenants.length > 0 && !selected && !unknownTenant ? (
        <LoadingBlock message="Selecting workspace…" />
      ) : null}

      {selected && !unknownTenant ? (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid var(--aisbp-border, #e2e8f0)',
            background: 'var(--aisbp-surface-muted, #f8fafc)',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>Configuring CRM for</p>
          <p style={{ margin: '0.2rem 0 0', fontSize: '1.05rem', fontWeight: 800, color: 'var(--aisbp-text-heading, #0f172a)' }}>{selected.name}</p>
          <p style={{ margin: '0.4rem 0 0', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            {(() => {
              const summary = connectionSummaryPill(conn, connLoading, selected);
              if (summary) return <StatusPill label={summary.label} tone={summary.tone} />;
              if (connLoading)
                return <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>Loading status…</span>;
              return null;
            })()}
            <Link
              href={`/app/tenant/${selected.id}/assistant`}
              style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--aisbp-tenant-nav-active-text, #2563eb)' }}
            >
              Open workspace →
            </Link>
          </p>
        </div>
      ) : null}

      {selected && !unknownTenant ? (
        <>
          <SectionCard
            title="Connection details"
            subtitle="Location ID and private integration token from your CRM."
          >
            <form onSubmit={onSave} style={{ maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={mvpLabelStyle}>
                  CRM location ID
                  <input
                    value={loc}
                    onChange={e => setLoc(e.target.value)}
                    placeholder="From CRM location settings"
                    autoComplete="off"
                    style={mvpInputStyle}
                  />
                </label>
                <p style={mvpFieldHint}>Found in CRM under the workspace’s location settings.</p>
              </div>
              <div>
                <label style={mvpLabelStyle}>
                  CRM private integration token
                  <input
                    type="password"
                    value={pit}
                    onChange={e => setPit(e.target.value)}
                    placeholder="Leave blank on save if unchanged"
                    autoComplete="off"
                    style={mvpInputStyle}
                  />
                </label>
                <p style={mvpFieldHint}>Paste a new token to update the connection. Leave blank to keep the current token.</p>
              </div>
              <button type="submit" disabled={saving} style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: saving ? 0.75 : 1 }}>
                {saving ? 'Saving…' : 'Save connection'}
              </button>
            </form>
          </SectionCard>

          <SectionCard title="Connection status" subtitle="Current status for the selected workspace.">
            {connLoading && !conn ? (
              <LoadingBlock message="Loading connection…" />
            ) : conn ? (
              <>
                <p style={{ margin: '0 0 0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  {(() => {
                    if (conn.connected && conn.status === 'CONNECTED') {
                      return <StatusPill label="Connected" tone="ok" />;
                    }
                    if (conn.status === 'INVALID') return <StatusPill label="Reconnect required" tone="bad" />;
                    if (conn.status === 'ERROR') return <StatusPill label="Needs review" tone="bad" />;
                    if (conn.status === 'DISCONNECTED')
                      return <StatusPill label="Not connected" tone="warn" />;
                    return <StatusPill label={conn.status} tone={ghlTone(conn.status)} />;
                  })()}
                </p>
                <KeyValueRows
                  rows={[
                    { label: 'Location ID', value: conn.ghlLocationId ?? '—', mono: true },
                    { label: 'Verified at', value: formatDateTime(conn.verifiedAt) },
                    { label: 'Last health check', value: formatDateTime(conn.lastHealthCheckAt) },
                    { label: 'Connection token', value: conn.maskToken ? 'Saved and hidden' : '—' },
                    {
                      label: 'Last error',
                      value: conn.lastError ? (
                        <span style={{ color: 'var(--aisbp-pill-bad-fg, #b91c1c)' }}>{conn.lastError}</span>
                      ) : (
                        '—'
                      ),
                    },
                  ]}
                />
                {conn.metadata && Object.keys(conn.metadata).length > 0 ? (
                  <details style={{ marginTop: '0.75rem', fontSize: '0.82rem' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--aisbp-text-secondary, #444)' }}>Support details</summary>
                    <pre
                      style={{
                        margin: '0.5rem 0 0',
                        padding: '0.5rem',
                        background: 'var(--aisbp-card-subtle, #f6f6f6)',
                        borderRadius: '4px',
                        overflow: 'auto',
                        maxHeight: '180px',
                        color: 'var(--aisbp-text-secondary, #334155)',
                      }}
                    >
                      {JSON.stringify(conn.metadata, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </>
            ) : (
              <EmptyState title="No connection data" />
            )}

            <div style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => void onVerify()}
                disabled={verifying}
                style={{ ...mvpPrimaryButtonStyle, opacity: verifying ? 0.75 : 1 }}
              >
                {verifying ? 'Verifying…' : 'Verify connection'}
              </button>
              <button
                type="button"
                onClick={() => void onDisconnect()}
                disabled={disconnecting}
                style={{ ...mvpDangerButtonStyle, opacity: disconnecting ? 0.75 : 1 }}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </SectionCard>

          {health ? (
            <SectionCard title="Latest health check" subtitle="Result from the most recent health run this session.">
              <KeyValueRows
                rows={[
                  {
                    label: 'Result',
                    value: (
                      <StatusPill
                        label={health.healthy ? 'Healthy' : 'Unhealthy'}
                        tone={health.healthy ? 'ok' : 'bad'}
                      />
                    ),
                  },
                  { label: 'Message', value: health.message },
                  { label: 'Timestamp', value: formatDateTime(health.timestamp) },
                ]}
              />
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function AgencyGhlConnectionsPage() {
  return (
    <Suspense
      fallback={
        <div>
          <PageHeader title="CRM Connection" eyebrow="Agency account" />
          <LoadingBlock message="Loading page…" />
        </div>
      }
    >
      <AgencyGhlConnectionsInner />
    </Suspense>
  );
}
