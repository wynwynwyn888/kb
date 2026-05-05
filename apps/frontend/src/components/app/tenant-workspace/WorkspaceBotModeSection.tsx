'use client';

import { useState } from 'react';
import type { WorkspaceBotMode } from '@/lib/api';
import {
  clientAiRepliesDescription,
  isClientSelectableBotMode,
  SUGGESTIVE_MODE_NOTICE,
} from '@/lib/workspace-settings-display';

const clientOptions: { id: 'off' | 'autopilot'; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'autopilot', label: 'Auto' },
];

export function WorkspaceBotModeSection(props: {
  mode: WorkspaceBotMode;
  disabled: boolean;
  onChange: (m: WorkspaceBotMode) => Promise<void>;
}) {
  const { mode, disabled, onChange } = props;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const select = async (m: WorkspaceBotMode) => {
    if (m === mode || saving || disabled) return;
    if (!isClientSelectableBotMode(m)) return;
    setErr('');
    setSaving(true);
    try {
      await onChange(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        borderRadius: '12px',
        border: '1px solid var(--aisbp-border, #e2e8f0)',
        background: 'var(--aisbp-surface, #fff)',
        padding: '1rem 1.1rem 1.1rem',
        marginBottom: '1.1rem',
        color: 'var(--aisbp-text, #0f172a)',
      }}
    >
      <div style={{ marginBottom: '0.75rem' }}>
        <h2
          style={{
            margin: 0,
            fontSize: '0.95rem',
            fontWeight: 700,
            color: 'var(--aisbp-text-heading, #0f172a)',
            letterSpacing: '-0.02em',
          }}
        >
          AI replies
        </h2>
        <p
          style={{
            margin: '0.3rem 0 0',
            fontSize: '0.8rem',
            color: 'var(--aisbp-muted, #64748b)',
            lineHeight: 1.45,
            maxWidth: '36rem',
          }}
        >
          Choose whether the assistant sends automatic replies in this workspace.
        </p>
      </div>

      {mode === 'suggestive' ? (
        <p
          style={{
            margin: '0 0 0.65rem',
            fontSize: '0.78rem',
            color: 'var(--aisbp-muted, #64748b)',
            lineHeight: 1.5,
            padding: '0.55rem 0.65rem',
            borderRadius: '8px',
            background: 'var(--aisbp-stat-tile-bg, #f8fafc)',
            border: '1px solid var(--aisbp-border, #e2e8f0)',
          }}
          role="status"
        >
          {SUGGESTIVE_MODE_NOTICE}
        </p>
      ) : null}

      {err ? (
        <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: '#b91c1c' }} role="alert">
          {err}
        </p>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))',
          gap: '0.55rem',
        }}
        role="radiogroup"
        aria-label="AI replies"
      >
        {clientOptions.map(o => {
          const matches = mode !== 'suggestive' && mode === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={matches}
              disabled={saving || disabled}
              onClick={() => void select(o.id)}
              style={{
                textAlign: 'left' as const,
                borderRadius: '10px',
                border: matches ? '2px solid #0f62fe' : '1px solid var(--aisbp-border, #e2e8f0)',
                background: matches ? 'rgba(15, 98, 254, 0.12)' : 'var(--aisbp-stat-tile-bg, #f8fafc)',
                padding: '0.65rem 0.7rem',
                cursor: saving || disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                minHeight: '4.4rem',
                display: 'flex',
                flexDirection: 'column' as const,
                justifyContent: 'center',
                gap: '0.2rem',
              }}
            >
              <span
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: matches ? '#0f62fe' : 'var(--aisbp-text-heading, #0f172a)',
                }}
              >
                {o.label}
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.4 }}>
                {clientAiRepliesDescription(o.id)}
              </span>
            </button>
          );
        })}
      </div>
      {saving ? <p style={{ margin: '0.55rem 0 0', fontSize: '0.72rem', color: 'var(--aisbp-muted, #94a3b8)' }}>Saving…</p> : null}
    </div>
  );
}
