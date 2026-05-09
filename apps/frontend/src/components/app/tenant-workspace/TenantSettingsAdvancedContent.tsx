'use client';

import { formatDateTime, KeyValueRows, SectionCard, StatusPill } from '@/components/app/mvp-ui';
import { useAuth } from '@/contexts/AuthContext';
import { crmLastCheckedIso, formatWorkspaceSettingsDateTime, ghlLocationDisplayLabel } from '@/lib/workspace-settings-display';
import { useTenantSettings } from './tenant-settings-context';

export function TenantSettingsAdvancedContent() {
  const { tenantId, tenantName, tenantStatus, botMode, promptConfigSnap, ghl, ghlLoadErr } = useTenantSettings();
  const { user } = useAuth();
  const isAgencyStaff = Boolean(user?.agencyRole);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <SectionCard title="Technical details" subtitle="Identifiers and fine-grained status for support.">
        <KeyValueRows
          rows={[
            { label: 'Workspace name', value: tenantName ?? '—' },
            { label: 'Workspace account status', value: tenantStatus ? <StatusPill label={tenantStatus} tone="neutral" /> : '—' },
          ]}
        />
        {isAgencyStaff ? (
          <details style={{ marginTop: '0.75rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, color: 'var(--aisbp-muted, #64748b)', listStyle: 'none' }}>
              Support details
            </summary>
            <div style={{ marginTop: '0.65rem' }}>
              <KeyValueRows
                rows={[
                  { label: 'Workspace ID', value: tenantId, mono: true },
                  { label: 'AI replies (internal mode)', value: botMode, mono: true },
                  { label: 'Reply temperature (numeric)', value: promptConfigSnap != null ? String(promptConfigSnap.temperature) : '—' },
                  {
                    label: 'Model override',
                    value: promptConfigSnap?.modelOverride?.trim() || '—',
                    mono: !!promptConfigSnap?.modelOverride?.trim(),
                  },
                  {
                    label: 'Bot instructions record',
                    value: promptConfigSnap?.name
                      ? `${promptConfigSnap.name}${promptConfigSnap.isActive === false ? ' (inactive)' : ''}`
                      : '—',
                  },
                ]}
              />
            </div>
          </details>
        ) : null}
      </SectionCard>

      <SectionCard
        title="CRM (diagnostics)"
        subtitle={isAgencyStaff ? 'Raw connection fields. Use General → CRM connection for day-to-day status.' : 'Connection details for support.'}
      >
        {ghlLoadErr ? (
          <p style={{ fontSize: '0.84rem', color: '#b91c1c', margin: 0 }}>{ghlLoadErr}</p>
        ) : ghl ? (
          <KeyValueRows
            rows={[
              { label: 'API status', value: ghl.status, mono: true },
              { label: 'Connected', value: ghl.connected ? 'Yes' : 'No' },
              ...(isAgencyStaff ? [{ label: 'Location ID', value: ghl.ghlLocationId?.trim() || '—', mono: true } as const] : []),
              { label: 'Location display', value: ghlLocationDisplayLabel(ghl) },
              { label: 'Last checked (formatted)', value: formatWorkspaceSettingsDateTime(crmLastCheckedIso(ghl)) },
              ...(isAgencyStaff
                ? ([
                    { label: 'Verified at (raw)', value: ghl.verifiedAt ?? '—', mono: true },
                    { label: 'Last health check (raw)', value: ghl.lastHealthCheckAt ?? '—', mono: true },
                    { label: 'Last error', value: ghl.lastError?.trim() || '—' },
                  ] as const)
                : ([] as const)),
            ]}
          />
        ) : (
          <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>No CRM connection loaded.</p>
        )}
      </SectionCard>

      {isAgencyStaff ? (
        <SectionCard title="Timestamps" subtitle="Server-style timestamps for troubleshooting.">
          <KeyValueRows
            rows={[
              {
                label: 'CRM verified (locale)',
                value: formatDateTime(ghl?.verifiedAt ?? null),
              },
              {
                label: 'CRM health check (locale)',
                value: formatDateTime(ghl?.lastHealthCheckAt ?? null),
              },
            ]}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
