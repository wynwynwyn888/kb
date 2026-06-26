'use client';

import { useState } from 'react';
import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/contexts/AuthContext';
import type { OnboardApi } from '@/lib/api/onboard';

const asStr = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export default function SyncPreviewPage() {
  const { api } = useAuth();
  const [projectId, setProjectId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [syncRuns, setSyncRuns] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDryRun = async () => {
    if (!api || !projectId.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.kbDryRun(projectId.trim());
      setResult(res);
      const runs = await api.getSyncRuns(projectId.trim());
      setSyncRuns(runs);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dry-run failed');
    } finally { setLoading(false); }
  };

  const payload = result?.['payloadPreview'] as Record<string, unknown> | undefined;
  const sections = asArr(result?.['sectionsIncluded']);
  const missing = asArr(result?.['missingFields']);
  const blockers = asArr(result?.['blockers']);
  const warnings = asArr(result?.['warnings']);

  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          Sync Preview
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
          Run a dry-run to preview what would sync to KB (no writes, no tenants created)
        </p>
      </div>

      <PlaceholderCard title="KB Dry-Run">
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--aisbp-text, #0f172a)' }}>
              Project ID
            </label>
            <input
              type="text"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              placeholder="Enter project ID (UUID)"
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)', fontSize: '0.9rem', background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)', boxSizing: 'border-box' }}
            />
          </div>
          <button type="button" onClick={handleDryRun} disabled={loading || !projectId.trim()}
            style={{ padding: '0.55rem 1.5rem', borderRadius: 10, border: 'none', background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: '0.88rem', cursor: loading || !projectId.trim() ? 'not-allowed' : 'pointer', opacity: loading || !projectId.trim() ? 0.7 : 1, whiteSpace: 'nowrap' }}>
            {loading ? 'Running...' : 'Run KB Dry-Run'}
          </button>
        </div>
        {error && <div style={{ padding: '0.5rem 0.75rem', background: '#FEE2E2', borderRadius: 8, fontSize: '0.82rem', color: '#DC2626', marginBottom: '1rem' }}>{error}</div>}
        <div style={{ padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.8rem', color: '#92400E' }}>
          Dry run only — no KB/GHL writes, no tenant creation, no messages sent.
        </div>
      </PlaceholderCard>

      {result && (
        <>
          <PlaceholderCard title={`Dry-Run Result: ${asStr(result?.['displayLabel']) || asStr(result?.['clientKey']) || '--'}`}>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <StatusPill status={asStr(result?.['status'], 'PENDING')} />
              <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)' }}>
                Project: {(asStr(result?.['onboardingProjectId'])).slice(0, 8)}
              </span>
              {Boolean(result?.['idempotent']) && (
                <span style={{ fontSize: '0.78rem', padding: '0.15rem 0.5rem', borderRadius: 999, background: '#DBEAFE', color: '#1E40AF', fontWeight: 600 }}>
                  Idempotent (cached)
                </span>
              )}
              {result?.['previousRunStale'] === true && (
                <span style={{ fontSize: '0.78rem', padding: '0.15rem 0.5rem', borderRadius: 999, background: '#FEF3C7', color: '#D97706', fontWeight: 600 }}>
                  Previous run stale — fresh generated
                </span>
              )}
              {Boolean(result?.['sourceSnapshotHash']) && (
                <span style={{ fontSize: '0.75rem', color: 'var(--aisbp-muted, #64748b)', fontFamily: 'monospace' }}>
                  Hash: {asStr(result?.['sourceSnapshotHash'])}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {sections.length > 0 && (
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 600, color: '#16A34A' }}>✅ Sections: </span>
                  <span style={{ color: 'var(--aisbp-text, #0f172a)' }}>{sections.join(', ')}</span>
                </div>
              )}
              {warnings.length > 0 && (
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 600, color: '#D97706' }}>⚠️ Warnings: </span>
                  <span style={{ color: 'var(--aisbp-text, #0f172a)' }}>{warnings.join(', ')}</span>
                </div>
              )}
              {missing.length > 0 && (
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 600, color: '#DC2626' }}>❌ Missing: </span>
                  <span style={{ color: '#DC2626' }}>{missing.join(', ')}</span>
                </div>
              )}
              {blockers.length > 0 && (
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 600, color: '#DC2626' }}>🚫 Blockers: </span>
                  <span style={{ color: '#DC2626' }}>{blockers.join(', ')}</span>
                </div>
              )}
            </div>

            {payload && (
              <div style={{ marginTop: '0.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.5rem', color: 'var(--aisbp-text, #0f172a)' }}>
                  Payload Preview
                </h3>
                <pre style={{ background: '#1e293b', color: '#e2e8f0', padding: '1rem', borderRadius: 10, fontSize: '0.78rem', overflow: 'auto', maxHeight: 400, lineHeight: 1.5, fontFamily: 'monospace', margin: 0 }}>
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            )}
          </PlaceholderCard>

          <PlaceholderCard title="Apply KB Tenant + Identity Only">
            <div style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', background: '#FEF3C7', borderRadius: 8, fontSize: '0.8rem', color: '#92400E' }}>
              This creates/updates the KB tenant shell only. Bot profile, prompt config, FAQ, booking, handover, follow-up, GHL sync, and outbound sending are not synced in this step. AISBP_OUTBOUND_THROUGH_KB_ENABLED remains false.
            </div>
            {result?.['syncRunId'] && result?.['status'] === 'DRY_RUN_PASSED' ? (
              <ApplyForm
                projectId={projectId}
                syncRunId={asStr(result?.['syncRunId'])}
                api={api}
                onChecked={(r) => setResult(r)}
              />
            ) : (
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button type="button" disabled
                  style={{ padding: '0.55rem 1.25rem', borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)', background: '#F1F5F9', color: '#94A3B8', fontWeight: 600, fontSize: '0.85rem', cursor: 'not-allowed' }}>
                  Apply blocked
                </button>
                <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>
                  Run a successful dry-run first. Project must be approved and dry-run must pass.
                </span>
              </div>
            )}
          </PlaceholderCard>
        </>
      )}

      {syncRuns.length > 0 && (
        <PlaceholderCard title="Sync Run History">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {syncRuns.map((run, i) => (
              <div key={i} style={{ display: 'flex', gap: '1rem', padding: '0.4rem 0', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)', fontSize: '0.82rem', alignItems: 'center' }}>
                <span style={{ color: 'var(--aisbp-muted, #64748b)', minWidth: 80 }}>{asStr(run['targetSystem'])}</span>
                <span style={{ color: 'var(--aisbp-muted, #64748b)', minWidth: 70 }}>{asStr(run['mode']).replace('_', ' ')}</span>
                <StatusPill status={asStr(run['status'])} />
                <span style={{ color: 'var(--aisbp-muted, #64748b)', fontSize: '0.75rem' }}>
                  {asStr(run['createdAt']) ? new Date(asStr(run['createdAt'])).toLocaleString() : ''}
                </span>
              </div>
            ))}
          </div>
        </PlaceholderCard>
      )}
    </OnboardChrome>
  );
}

function ApplyForm({ projectId, syncRunId, api, onChecked }: {
  projectId: string;
  syncRunId: string;
  api: OnboardApi | null;
  onChecked: (r: Record<string, unknown>) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [idemKey, setIdemKey] = useState('');
  const [note, setNote] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const handleCheck = async () => {
    if (!api || !confirmed || !idemKey.trim()) return;
    setChecking(true); setCheckError(null);
    try {
      const res = await api.kbApply(projectId, syncRunId, idemKey.trim(), true, note || undefined);
      onChecked(res);
      // If tenant-only apply succeeded, show clear message
      if (res?.['applied'] === true) {
        setCheckError(null);
      }
    } catch (err: unknown) {
      setCheckError(err instanceof Error ? err.message : 'Apply failed');
    } finally { setChecking(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--aisbp-text, #0f172a)' }}>
            Idempotency Key * (unique per check)
          </label>
          <input type="text" value={idemKey} onChange={e => setIdemKey(e.target.value)}
            placeholder="e.g. gate-check-001"
            style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: 8, border: '1px solid var(--aisbp-border, #e2e8f0)', fontSize: '0.85rem', background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)', boxSizing: 'border-box' }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--aisbp-text, #0f172a)', cursor: 'pointer' }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          <span>I confirm I am applying KB tenant identity only. No bot config, automation, or messages will be sent.</span>
        </label>
      </div>
      {checkError && <div style={{ padding: '0.5rem 0.75rem', background: '#FEE2E2', borderRadius: 8, fontSize: '0.82rem', color: '#DC2626', marginBottom: '1rem' }}>{checkError}</div>}
      <button type="button" onClick={handleCheck}
        disabled={!confirmed || !idemKey.trim() || checking}
        style={{
          padding: '0.55rem 1.5rem', borderRadius: 10, border: 'none',
          background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: '0.88rem',
          cursor: !confirmed || !idemKey.trim() || checking ? 'not-allowed' : 'pointer',
          opacity: !confirmed || !idemKey.trim() || checking ? 0.7 : 1,
        }}>
        {checking ? 'Applying...' : 'Apply KB Tenant + Identity'}
      </button>
    </div>
  );
}
