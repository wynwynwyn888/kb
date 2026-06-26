'use client';

import type { ReactNode } from 'react';

export function SafetyBanner() {
  return (
    <div
      style={{
        background: '#FEF3C7',
        border: '1px solid #FCD34D',
        borderRadius: 10,
        padding: '0.65rem 1rem',
        marginBottom: '1.25rem',
        fontSize: '0.82rem',
        color: '#92400E',
        fontWeight: 600,
      }}
    >
      Foundation shell only — no live KB/GHL sync, no production writes.
    </div>
  );
}
