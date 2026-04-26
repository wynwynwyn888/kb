'use client';

import { useState } from 'react';
import type { WorkspaceBotMode } from '@/lib/api';

const options: { id: WorkspaceBotMode; label: string; line: string }[] = [
  { id: 'off', label: 'Off', line: 'Stops automatic AI replies' },
  { id: 'suggestive', label: 'Suggestive', line: 'Builds replies without auto-sending to HighLevel' },
  { id: 'autopilot', label: 'Auto', line: 'Sends replies to the conversation automatically' },
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
        border: '1px solid #e2e8f0',
        background: '#fff',
        padding: '1rem 1.1rem 1.1rem',
        marginBottom: '1.1rem',
      }}
    >
      <div style={{ marginBottom: '0.75rem' }}>
        <h2
          style={{
            margin: 0,
            fontSize: '0.95rem',
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.02em',
          }}
        >
          Bot mode
        </h2>
        <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.45, maxWidth: '36rem' }}>
          Choose how this workspace uses AI for incoming conversations. Requires a connected HighLevel account for live
          delivery.
        </p>
      </div>

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
        aria-label="Bot mode"
      >
        {options.map(o => {
          const selected = mode === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving || disabled}
              onClick={() => void select(o.id)}
              style={{
                textAlign: 'left' as const,
                borderRadius: '10px',
                border: selected ? '2px solid #0f62fe' : '1px solid #e2e8f0',
                background: selected ? 'rgba(15, 98, 254, 0.06)' : '#f8fafc',
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
                  color: selected ? '#0f62fe' : '#0f172a',
                }}
              >
                {o.label}
              </span>
              <span style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.4 }}>{o.line}</span>
            </button>
          );
        })}
      </div>
      {saving ? <p style={{ margin: '0.55rem 0 0', fontSize: '0.72rem', color: '#94a3b8' }}>Saving…</p> : null}
    </div>
  );
}
