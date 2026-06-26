'use client';

import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';

export default function SettingsPage() {
  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          Settings
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
          Integration and feature flag configuration (future)
        </p>
      </div>

      <PlaceholderCard title="KB Integration">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
          <SettingRow label="Connection Status" value="Not connected" />
          <SettingRow label="Base URL" value="https://kb.aisalesbot.pro/api/v1" />
          <SettingRow label="Sync Enabled" value="false" />
        </div>
        <div style={{ padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.8rem', color: '#92400E' }}>
          KB integration not connected — backend Onboard module pending (PR 3+). Sync will be enabled after PR 9 and staging validation.
        </div>
      </PlaceholderCard>

      <PlaceholderCard title="GHL Integration">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
          <SettingRow label="Connection Status" value="Not connected" />
          <SettingRow label="API Base URL" value="https://services.leadconnectorhq.com" />
          <SettingRow label="Sync Mode" value="dry_run (default)" />
          <SettingRow label="Apply Sync" value="Disabled" />
        </div>
        <div style={{ padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.8rem', color: '#92400E' }}>
          GHL apply sync disabled by default. Must remain off until explicitly approved (future PR 10+).
        </div>
      </PlaceholderCard>

      <PlaceholderCard title="Feature Flags">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
          <FlagRow label="ONBOARD_AGENT_INTAKE_ENABLED" value="false" note="PR 6" />
          <FlagRow label="ONBOARD_KB_SYNC_ENABLED" value="false" note="PR 8-9 (requires staging dry-run + Wyn approval)" />
          <FlagRow label="ONBOARD_GHL_SYNC_ENABLED" value="false" note="Future PR 10+ (requires explicit approval)" />
          <FlagRow label="ONBOARD_EXTERNAL_NOTIFICATIONS_ENABLED" value="false" note="Future PR 11" />
        </div>
      </PlaceholderCard>

      <PlaceholderCard title="Notification Settings">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
          <SettingRow label="Channel" value="In-app review queue (MVP)" />
          <SettingRow label="WhatsApp/Email" value="Off (future PR 11)" />
        </div>
      </PlaceholderCard>
    </OnboardChrome>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: 'var(--aisbp-muted, #64748b)', fontSize: '0.78rem' }}>{label}</span>
      <div style={{ fontWeight: 600, color: 'var(--aisbp-text, #0f172a)' }}>{value}</div>
    </div>
  );
}

function FlagRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.4rem 0' }}>
      <code style={{ fontSize: '0.78rem', minWidth: 280, color: 'var(--aisbp-text, #0f172a)' }}>{label}</code>
      <span style={{
        padding: '0.1rem 0.45rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
        background: value === 'false' ? '#F1F5F9' : '#DCFCE7',
        color: value === 'false' ? '#64748B' : '#16A34A',
      }}>
        {value}
      </span>
      <span style={{ fontSize: '0.75rem', color: 'var(--aisbp-muted, #64748b)' }}>{note}</span>
    </div>
  );
}
