'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { checkGhlHealth, getGhlConnection, type GhlConnectionStatus } from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  KeyValueRows,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  formatDateTime,
} from '@/components/app/mvp-ui';

export default function TenantGhlStatusPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();
  const [conn, setConn] = useState<GhlConnectionStatus | null>(null);
  const [connLoading, setConnLoading] = useState(true);
  const [health, setHealth] = useState<{
    healthy: boolean;
    message: string;
    timestamp: string;
  } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    if (!token) {
      setConnLoading(false);
      return;
    }
    setConnLoading(true);
    setErr('');
    try {
      const c = await getGhlConnection(token, tenantId);
      setConn(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
      setConn(null);
    } finally {
      setConnLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runHealth = async () => {
    if (!token) return;
    setErr('');
    setHealthLoading(true);
    try {
      const h = await checkGhlHealth(token, tenantId);
      setHealth(h);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Health failed');
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  };

  const ghlTone = (s: GhlConnectionStatus['status']): 'ok' | 'warn' | 'bad' | 'neutral' => {
    if (s === 'CONNECTED') return 'ok';
    if (s === 'DISCONNECTED') return 'neutral';
    if (s === 'INVALID' || s === 'ERROR') return 'bad';
    return 'neutral';
  };

  return (
    <div>
      <PageHeader title="HighLevel connection" eyebrow="Advanced" />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 0.85rem', lineHeight: 1.5, maxWidth: '560px' }}>
        Read-only status for this workspace. To change credentials, ask an agency admin to open{' '}
        <Link href={`/app/agency/settings/ghl?subaccount=${tenantId}`} style={{ color: '#2563eb', fontWeight: 600 }}>
          HighLevel
        </Link>
        .
      </p>
      {err && <ErrorBanner message={err} />}

      <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '0.85rem' }}>
        Connection check confirms AISBP can reach HighLevel with the saved token. Refresh loads the latest stored status.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={runHealth}
          disabled={healthLoading}
          style={{ padding: '0.4rem 0.65rem', opacity: healthLoading ? 0.7 : 1 }}
        >
          {healthLoading ? 'Checking…' : 'Run connection check'}
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={connLoading}
          style={{ padding: '0.4rem 0.65rem', opacity: connLoading ? 0.7 : 1 }}
        >
          {connLoading ? 'Refreshing…' : 'Refresh status'}
        </button>
      </div>

      <SectionCard title="Connection">
        {connLoading && !conn ? (
          <LoadingBlock message="Loading connection…" />
        ) : conn ? (
          <>
            <p style={{ margin: '0 0 0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <StatusPill
                label={conn.connected ? 'Connected' : 'Not connected'}
                tone={conn.connected ? 'ok' : 'neutral'}
              />
              <StatusPill label={conn.status} tone={ghlTone(conn.status)} />
            </p>
            <KeyValueRows
              rows={[
                { label: 'Location ID', value: conn.ghlLocationId ?? '—', mono: true },
                { label: 'Last verified', value: formatDateTime(conn.verifiedAt) },
                { label: 'Last health check', value: formatDateTime(conn.lastHealthCheckAt) },
                { label: 'Connection token', value: conn.maskToken ? 'Saved and hidden' : '—' },
                {
                  label: 'Last error',
                  value: conn.lastError ? (
                    <span style={{ color: '#b71c1c' }}>{conn.lastError}</span>
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
            {conn.metadata && Object.keys(conn.metadata).length > 0 ? (
              <details style={{ marginTop: '0.75rem', fontSize: '0.82rem' }}>
                <summary style={{ cursor: 'pointer', color: '#444' }}>Support details</summary>
                <pre
                  style={{
                    margin: '0.5rem 0 0',
                    padding: '0.5rem',
                    background: '#f6f6f6',
                    borderRadius: '4px',
                    overflow: 'auto',
                    maxHeight: '200px',
                  }}
                >
                  {JSON.stringify(conn.metadata, null, 2)}
                </pre>
              </details>
            ) : null}
          </>
        ) : (
          <EmptyState
            title="No connection on file"
            detail="Once an agency admin saves HighLevel credentials for this workspace, status will appear here."
          />
        )}
      </SectionCard>

      {health ? (
        <SectionCard title="Latest connection check" subtitle="From the last check you ran above (this page does not auto-refresh).">
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
    </div>
  );
}
