'use client';

import type { CSSProperties, ReactNode } from 'react';

const cardStyle: CSSProperties = {
  border: '1px solid #e5e5e5',
  borderRadius: '8px',
  padding: '1rem',
  background: '#fff',
};

export function SectionCard({
  title,
  subtitle,
  children,
  accent,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  accent?: 'default' | 'muted' | 'warn';
}) {
  const bg =
    accent === 'muted' ? '#fafafa' : accent === 'warn' ? '#fff8f0' : '#fff';
  return (
    <section
      style={{
        ...cardStyle,
        background: bg,
        marginBottom: '1rem',
      }}
    >
      <h2 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.25rem' }}>{title}</h2>
      {subtitle && (
        <p style={{ fontSize: '0.8rem', color: '#666', margin: '0 0 0.75rem' }}>{subtitle}</p>
      )}
      {children}
    </section>
  );
}

export function KeyValueRows({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode; mono?: boolean }>;
}) {
  return (
    <dl style={{ margin: 0, display: 'grid', gap: '0.5rem' }}>
      {rows.map(({ label, value, mono }) => (
        <div
          key={label}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px, 38%) 1fr',
            gap: '0.75rem',
            fontSize: '0.88rem',
            alignItems: 'baseline',
          }}
        >
          <dt style={{ color: '#555', fontWeight: 500 }}>{label}</dt>
          <dd
            style={{
              margin: 0,
              wordBreak: 'break-word',
              fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
              fontSize: mono ? '0.82rem' : undefined,
            }}
          >
            {value === null || value === undefined || value === '' ? '—' : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'ok' | 'neutral' | 'warn' | 'bad';
}) {
  const colors = {
    ok: { bg: '#e6f7ed', fg: '#0d5c2e', border: '#b7e0c8' },
    neutral: { bg: '#f0f0f0', fg: '#333', border: '#ddd' },
    warn: { bg: '#fff3cd', fg: '#856404', border: '#ffe69c' },
    bad: { bg: '#fde8e8', fg: '#b71c1c', border: '#f5c2c7' },
  }[tone];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.5rem',
        borderRadius: '999px',
        fontSize: '0.78rem',
        fontWeight: 600,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {label}
    </span>
  );
}

export function LoadingBlock({ message = 'Loading…' }: { message?: string }) {
  return (
    <p style={{ color: '#555', fontSize: '0.9rem', margin: '0.5rem 0' }}>{message}</p>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: '0.65rem 0.85rem',
        borderRadius: '6px',
        background: '#fde8e8',
        color: '#8b1d1d',
        fontSize: '0.88rem',
        marginBottom: '1rem',
        border: '1px solid #f5c2c7',
      }}
    >
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        padding: '0.65rem 0.85rem',
        borderRadius: '6px',
        background: '#e6f7ed',
        color: '#0d5c2e',
        fontSize: '0.88rem',
        marginBottom: '1rem',
        border: '1px solid #b7e0c8',
      }}
    >
      {message}
    </div>
  );
}

export const mvpFieldHint: CSSProperties = {
  fontSize: '0.78rem',
  color: '#666',
  marginTop: '0.25rem',
  lineHeight: 1.45,
};

export const mvpLabelStyle: CSSProperties = {
  display: 'block',
  fontWeight: 500,
  fontSize: '0.88rem',
};

export const mvpInputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '0.35rem',
  padding: '0.5rem 0.65rem',
  borderRadius: '6px',
  border: '1px solid #ccc',
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

/** Selects and multi-line controls — same shell as inputs, pointer cursor for dropdowns. */
export const mvpSelectStyle: CSSProperties = {
  ...mvpInputStyle,
  cursor: 'pointer',
  backgroundColor: '#fff',
};

export const mvpButtonStyle: CSSProperties = {
  padding: '0.45rem 0.85rem',
  borderRadius: '6px',
  border: '1px solid #ccc',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '0.88rem',
};

export const mvpPrimaryButtonStyle: CSSProperties = {
  ...mvpButtonStyle,
  background: '#0070f3',
  borderColor: '#0070f3',
  color: '#fff',
  fontWeight: 600,
};

export function EmptyState({
  title,
  detail,
  compact,
}: {
  title: string;
  detail?: string;
  /** Tighter padding for inline / secondary empty regions */
  compact?: boolean;
}) {
  return (
    <div
      style={{
        padding: compact ? '0.65rem 0.75rem' : '0.85rem',
        borderRadius: '8px',
        background: '#f8f9fb',
        border: '1px solid #e8eaef',
        fontSize: compact ? '0.84rem' : '0.88rem',
        color: '#555',
        lineHeight: 1.45,
      }}
    >
      <strong style={{ display: 'block', marginBottom: detail ? '0.35rem' : 0, color: '#333' }}>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

/** Consistent top-of-page title for agency + tenant shells. */
export function PageHeader({
  title,
  eyebrow,
}: {
  title: string;
  eyebrow?: string;
}) {
  return (
    <header style={{ marginBottom: '1rem' }}>
      {eyebrow ? (
        <p
          style={{
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#777',
            margin: '0 0 0.4rem',
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </p>
      ) : null}
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, lineHeight: 1.3, color: '#111' }}>{title}</h1>
    </header>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}
