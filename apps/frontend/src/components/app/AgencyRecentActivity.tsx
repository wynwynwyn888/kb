'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getQuotaAuditLog } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { appFloatingSecondaryButtonStyle } from '@/components/app/mvp-ui';

function oneLine(
  action: string,
  metadata: Record<string, unknown> | null,
  previous: number | null,
  newTotal: number | null,
): string {
  const m = metadata ?? {};
  if (action === 'subaccount.create' && m['name']) return `Workspace created (${String(m['name'])})`;
  if (action === 'subaccount.renamed' && m['previousName'] && m['newName']) {
    return `Renamed: ${String(m['previousName'])} → ${String(m['newName'])}`;
  }
  if (action === 'subaccount.deleted' && m['name']) return `Workspace removed (${String(m['name'])})`;
  if (action === 'agency.ai_settings' && m['provider']) {
    return `AI settings: ${String(m['provider'])}${m['keyRotated'] ? ', key updated' : ''}`;
  }
  if (action === 'agency.active_provider') {
    return `Active provider → ${String(m['newActiveProvider'] ?? '—')}`;
  }
  if (action === 'agency.reply_policy') return 'Workspace reply limits updated';
  if (action === 'agency.default_quota') {
    return `Default quota: ${previous ?? '—'} → ${newTotal ?? '—'}`;
  }
  if (action === 'subaccount.topup') return 'Quota top-up';
  return 'Activity recorded';
}

/**
 * Compact audit strip for the agency sidebar (real rows only; no mock data).
 */
export function AgencyRecentActivity() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<
    Array<{
      id: string;
      action: string;
      created_at: string;
      metadata: Record<string, unknown> | null;
      previous_total: number | null;
      new_total: number | null;
    }>
  >([]);

  useEffect(() => {
    const agencyId = user?.agencyId;
    if (!token || !agencyId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await getQuotaAuditLog(token, { limit: 5 });
        if (!cancelled) setRows(Array.isArray(r) ? r : []);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.agencyId]);

  if (rows.length === 0) {
    return (
      <div style={{ marginTop: '1rem' }}>
        <p style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.35rem' }}>Recent activity</p>
        <p style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.4, margin: 0 }}>No events yet.</p>
        <p style={{ fontSize: '0.68rem', color: '#cbd5e1', lineHeight: 1.4, margin: '0.35rem 0 0' }}>Setup changes will appear here.</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <p style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.35rem' }}>Recent activity</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.72rem', lineHeight: 1.45, color: '#64748b' }}>
        {rows.map(r => (
          <li key={r.id} style={{ marginBottom: '0.4rem' }}>
            <span style={{ color: '#94a3b8' }}>{r.created_at ? new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            <br />
            {oneLine(r.action, r.metadata, r.previous_total, r.new_total)}
          </li>
        ))}
      </ul>
      <Link
        href="/app/agency"
        style={{ ...appFloatingSecondaryButtonStyle, fontSize: '0.75rem', marginTop: '0.55rem' }}
      >
        View activity
      </Link>
    </div>
  );
}
