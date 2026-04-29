'use client';

import { useEffect, useState } from 'react';
import { getQuotaAuditLog } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/datetime-display';

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

function formatActivityWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-SG', {
      timeZone: DEFAULT_DISPLAY_TIMEZONE,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Agency quota / setup audit list (use inside Log page `SectionCard`). */
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
        const r = await getQuotaAuditLog(token, { limit: 20 });
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
      <p style={{ fontSize: '0.875rem', color: 'var(--aisbp-muted, #94a3b8)', lineHeight: 1.45, margin: 0 }}>
        No events yet. Setup and quota changes will appear here.
      </p>
    );
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--aisbp-text, #334155)' }}>
      {rows.map(r => (
        <li
          key={r.id}
          style={{
            marginBottom: '0.65rem',
            paddingBottom: '0.65rem',
            borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
          }}
        >
          <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #94a3b8)', fontWeight: 600 }}>
            {r.created_at ? formatActivityWhen(r.created_at) : '—'}
          </span>
          <div style={{ marginTop: '0.25rem', color: 'var(--aisbp-text-secondary, #475569)' }}>
            {oneLine(r.action, r.metadata, r.previous_total, r.new_total)}
          </div>
        </li>
      ))}
    </ul>
  );
}
