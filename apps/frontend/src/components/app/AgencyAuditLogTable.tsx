'use client';

import type { CSSProperties } from 'react';
import type { QuotaAuditLogRow } from '@/lib/api';
import { formatDateTime } from '@/components/app/mvp-ui';
import {
  quotaAuditActionLabel,
  quotaAuditChangedByLabel,
  quotaAuditDeltaAndBalanceAfter,
  quotaAuditWorkspaceLabel,
} from '@/lib/credits-billing-copy';

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.55rem 0.5rem',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
  color: 'var(--aisbp-muted, #64748b)',
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
};

const tdStyle: CSSProperties = {
  padding: '0.55rem 0.5rem',
  borderBottom: '1px solid var(--aisbp-border, #f1f5f9)',
  color: 'var(--aisbp-text, #0f172a)',
  fontSize: '0.86rem',
  verticalAlign: 'top',
};

export function AgencyAuditLogTable({
  rows,
  walletNameByTenant,
}: {
  rows: QuotaAuditLogRow[];
  walletNameByTenant?: Map<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-muted, #64748b)', margin: 0, lineHeight: 1.45 }}>
        No activity recorded yet.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
        <thead>
          <tr style={{ background: 'var(--aisbp-surface-muted, transparent)' }}>
            <th style={thStyle}>Date &amp; time</th>
            <th style={thStyle}>Activity</th>
            <th style={thStyle}>Workspace</th>
            <th style={thStyle}>Changed by</th>
            <th style={thStyle}>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const { change } = quotaAuditDeltaAndBalanceAfter(row);
            return (
              <tr key={row.id} style={{ background: 'var(--aisbp-table-row-bg, #fff)' }}>
                <td style={tdStyle}>{row.created_at ? formatDateTime(row.created_at) : '—'}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{quotaAuditActionLabel(row.action)}</td>
                <td style={tdStyle}>{quotaAuditWorkspaceLabel(row, walletNameByTenant)}</td>
                <td style={{ ...tdStyle, color: 'var(--aisbp-text-secondary, #334155)' }}>
                  {quotaAuditChangedByLabel(row)}
                </td>
                <td style={{ ...tdStyle, color: 'var(--aisbp-text-secondary, #334155)' }}>{change}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
