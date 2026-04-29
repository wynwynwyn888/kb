'use client';

import type { CSSProperties, ReactNode } from 'react';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/datetime-display';

const cardStyle: CSSProperties = {
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  borderRadius: '12px',
  padding: '1.15rem',
  background: 'var(--aisbp-surface, #fff)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
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
    accent === 'muted'
      ? 'var(--aisbp-card-subtle, #fafafa)'
      : accent === 'warn'
        ? 'var(--aisbp-warn-bg, #fff8f0)'
        : 'var(--aisbp-surface, #fff)';
  return (
    <section
      style={{
        ...cardStyle,
        background: bg,
        marginBottom: '1rem',
        color: 'var(--aisbp-text, #0f172a)',
      }}
    >
      <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem', color: 'var(--aisbp-text-heading, #0f172a)' }}>{title}</h2>
      {subtitle && (
        <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.85rem', lineHeight: 1.45 }}>{subtitle}</p>
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
      <dt style={{ color: 'var(--aisbp-muted, #64748b)', fontWeight: 600 }}>{label}</dt>
          <dd
            style={{
              margin: 0,
              wordBreak: 'break-word',
              fontFamily: 'inherit',
              fontSize: mono ? '0.82rem' : undefined,
              color: 'var(--aisbp-text, #0f172a)',
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
    ok: { bg: '#ecfdf5', fg: '#047857', border: '#bbf7d0' },
    neutral: {
      bg: 'var(--aisbp-nav-active-bg, #f8fafc)',
      fg: 'var(--aisbp-nav-text, #475569)',
      border: 'var(--aisbp-border, #e2e8f0)',
    },
    warn: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
    bad: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
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
    <p style={{ color: 'var(--aisbp-muted, #555)', fontSize: '0.9rem', margin: '0.5rem 0' }}>{message}</p>
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
  fontSize: '0.8rem',
  color: 'var(--aisbp-muted, #64748b)',
  marginTop: '0.35rem',
  lineHeight: 1.45,
};

export const mvpLabelStyle: CSSProperties = {
  display: 'block',
  fontWeight: 650,
  fontSize: '0.88rem',
  color: 'var(--aisbp-text-secondary, #334155)',
};

export const mvpInputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '0.35rem',
  padding: '0.55rem 0.7rem',
  borderRadius: '8px',
  border: '1px solid var(--aisbp-border-strong, #cbd5e1)',
  fontSize: '0.9rem',
  boxSizing: 'border-box',
  backgroundColor: 'var(--aisbp-input-bg, #fff)',
  color: 'var(--aisbp-text, #0f172a)',
};

/** Selects and multi-line controls — same shell as inputs, pointer cursor for dropdowns. */
export const mvpSelectStyle: CSSProperties = {
  ...mvpInputStyle,
  cursor: 'pointer',
  backgroundColor: 'var(--aisbp-input-bg, #fff)',
};

export const mvpButtonStyle: CSSProperties = {
  padding: '0.5rem 0.9rem',
  borderRadius: '8px',
  border: '1px solid var(--aisbp-border-strong, #cbd5e1)',
  background: 'var(--aisbp-surface, #fff)',
  cursor: 'pointer',
  fontSize: '0.88rem',
  fontWeight: 650,
  color: 'var(--aisbp-text-secondary, #334155)',
};

export const mvpPrimaryButtonStyle: CSSProperties = {
  ...mvpButtonStyle,
  background: '#2563eb',
  borderColor: '#2563eb',
  color: '#fff',
  fontWeight: 700,
};

export const mvpSecondaryButtonStyle: CSSProperties = {
  ...mvpButtonStyle,
  background: 'var(--aisbp-surface, #fff)',
  borderColor: 'var(--aisbp-border-strong, #cbd5e1)',
  color: 'var(--aisbp-text-secondary, #334155)',
};

export const mvpDangerButtonStyle: CSSProperties = {
  ...mvpButtonStyle,
  borderColor: '#fecaca',
  color: '#b91c1c',
  background: 'var(--aisbp-surface, #fff)',
};

/** In-app navigation: pill + soft shadow, no underline (use on `Link` or `button`). */
export const appFloatingSecondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.35rem',
  padding: '0.5rem 0.95rem',
  borderRadius: '10px',
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  background: 'var(--aisbp-surface, #fff)',
  boxShadow: '0 4px 16px rgba(15, 23, 42, 0.07)',
  fontSize: '0.8125rem',
  fontWeight: 650,
  color: 'var(--aisbp-text-heading, #0f172a)',
  textDecoration: 'none',
  cursor: 'pointer',
};

export const appFloatingPrimaryButtonStyle: CSSProperties = {
  ...appFloatingSecondaryButtonStyle,
  background: '#0f62fe',
  borderColor: '#0f62fe',
  color: '#fff',
  boxShadow: '0 6px 22px rgba(15, 98, 254, 0.32)',
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
        padding: compact ? '0.75rem 0.85rem' : '1rem',
        borderRadius: '10px',
        background: 'var(--aisbp-card-subtle, #f8f9fb)',
        border: '1px solid var(--aisbp-border, #e2e8f0)',
        fontSize: compact ? '0.84rem' : '0.88rem',
        color: 'var(--aisbp-text-secondary, #555)',
        lineHeight: 1.45,
      }}
    >
      <strong style={{ display: 'block', marginBottom: detail ? '0.35rem' : 0, color: 'var(--aisbp-text-heading, #0f172a)' }}>{title}</strong>
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
    <header style={{ marginBottom: '1.15rem' }}>
      {eyebrow ? (
        <p
          style={{
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--aisbp-muted, #64748b)',
            margin: '0 0 0.4rem',
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </p>
      ) : null}
      <h1
        style={{
          fontSize: '1.75rem',
          fontWeight: 800,
          margin: 0,
          lineHeight: 1.2,
          color: 'var(--aisbp-text-heading, #0f172a)',
          letterSpacing: '-0.025em',
        }}
      >
        {title}
      </h1>
    </header>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-SG', {
      timeZone: DEFAULT_DISPLAY_TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}
