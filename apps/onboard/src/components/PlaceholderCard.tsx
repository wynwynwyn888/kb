'use client';

import type { ReactNode } from 'react';

export function PlaceholderCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--aisbp-surface, #ffffff)',
        border: '1px solid var(--aisbp-border, #e2e8f0)',
        borderRadius: 14,
        padding: '1.5rem',
        marginBottom: '1.25rem',
      }}
    >
      <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
        {title}
      </h2>
      {children}
    </div>
  );
}
