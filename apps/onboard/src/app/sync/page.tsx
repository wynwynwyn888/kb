'use client';

import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';

export default function SyncPreviewPage() {
  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          Sync Preview
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
          Preview changes before syncing to KB and GHL
        </p>
      </div>

      <PlaceholderCard title="KB Sync Preview">
        <div style={{ padding: '1rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1rem' }}>✅</span>
            <span style={{ fontSize: '0.88rem', color: 'var(--aisbp-text, #0f172a)' }}>
              What will sync to KB (after approval):
            </span>
          </div>
          <ul style={{ margin: '0 0 1rem 2rem', padding: 0, fontSize: '0.85rem', lineHeight: 1.8 }}>
            <li>New Tenant: Dapper Dogs</li>
            <li>Knowledge Items: 15 FAQ items</li>
            <li>Prompt Config: Bot instructions</li>
            <li style={{ color: '#D97706' }}>⚠ Handover Rules: Not configured</li>
            <li style={{ color: '#D97706' }}>⚠ Follow-Up Rules: Not configured</li>
          </ul>
          <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
            This is a static preview. Actual KB sync dry-run and apply will be implemented in PR 8-9.
          </p>
        </div>
      </PlaceholderCard>

      <PlaceholderCard title="GHL Sync Preview">
        <div style={{ padding: '1rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1rem' }}>🔒</span>
            <span style={{ fontSize: '0.88rem', color: 'var(--aisbp-text, #0f172a)' }}>
              GHL sync disabled by default
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
            GHL apply sync is future (PR 10+). Only dry-run validation will be available in MVP.
          </p>
        </div>
      </PlaceholderCard>

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
        <button
          type="button"
          style={{
            padding: '0.55rem 1.25rem', borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)',
            background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          Run KB Dry-Run
        </button>
        <button
          type="button"
          style={{
            padding: '0.55rem 1.25rem', borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)',
            background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          Apply KB Sync
        </button>
      </div>
    </OnboardChrome>
  );
}
