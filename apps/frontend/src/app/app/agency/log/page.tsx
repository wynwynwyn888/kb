'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getQuotaAuditLog, type QuotaAuditLogRow } from '@/lib/api';
import {
  type QuotaAuditLogFilter,
  quotaAuditActionLabel,
  quotaAuditChangedByLabel,
  quotaAuditDeltaAndBalanceAfter,
  quotaAuditLogFilterKind,
  quotaAuditWorkspaceLabel,
} from '@/lib/credits-billing-copy';
import { AgencyAuditLogTable } from '@/components/app/AgencyAuditLogTable';
import { ErrorBanner, LoadingBlock, PageHeader, SectionCard, mvpInputStyle, mvpSelectStyle } from '@/components/app/mvp-ui';

export default function AgencyLogPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<QuotaAuditLogRow[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<QuotaAuditLogFilter>('all');

  useEffect(() => {
    try {
      const focus = new URLSearchParams(window.location.search).get('focus');
      if (focus === 'credits') setFilter('credits');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!token || !user?.agencyId) return;
    let cancelled = false;
    setLoading(true);
    setErr('');
    (async () => {
      try {
        const r = await getQuotaAuditLog(token, { limit: 120 });
        if (!cancelled) setRows(Array.isArray(r) ? r : []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not load activity');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.agencyId]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter(row => {
      if (filter !== 'all' && quotaAuditLogFilterKind(row.action) !== filter) return false;
      if (!needle) return true;
      const { change } = quotaAuditDeltaAndBalanceAfter(row);
      const hay = [
        row.created_at,
        quotaAuditWorkspaceLabel(row),
        quotaAuditChangedByLabel(row),
        quotaAuditActionLabel(row.action),
        change,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, filter]);

  return (
    <div>
      <PageHeader title="Activity log" eyebrow="Agency account" />
      <p
        style={{
          fontSize: '0.88rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 1rem',
          lineHeight: 1.55,
          maxWidth: '44rem',
        }}
      >
        A clear history of credits, workspaces, and AI configuration changes across your agency.
      </p>

      {err ? <ErrorBanner message={err} /> : null}

      {loading ? (
        <LoadingBlock message="Loading activity…" />
      ) : (
        <SectionCard title="Activity" subtitle="Newest entries first. Search and filter are applied on this device only.">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.65rem',
              alignItems: 'center',
              marginBottom: '1rem',
            }}
          >
            <input
              type="search"
              placeholder="Search activity"
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label="Search activity"
              style={{ ...mvpInputStyle, flex: '1 1 220px', minWidth: '200px', marginTop: 0 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--aisbp-text-secondary, #334155)' }}>
              <span style={{ fontWeight: 600 }}>Show</span>
              <select
                value={filter}
                onChange={e => setFilter(e.target.value as QuotaAuditLogFilter)}
                aria-label="Filter activity type"
                style={{ ...mvpSelectStyle, marginTop: 0, minWidth: '10.5rem', padding: '0.45rem 0.55rem' }}
              >
                <option value="all">All activity</option>
                <option value="workspace">Workspace</option>
                <option value="credits">Credits</option>
                <option value="ai">AI settings</option>
              </select>
            </label>
          </div>
          <AgencyAuditLogTable rows={filtered} />
        </SectionCard>
      )}
    </div>
  );
}
