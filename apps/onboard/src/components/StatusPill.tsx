'use client';

import { statusPillColors } from '@/lib/mock-data';

export function StatusPill({ status }: { status: string }) {
  const colors = statusPillColors[status] ?? { bg: '#F1F5F9', text: '#64748B' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.55rem',
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 700,
        backgroundColor: colors.bg,
        color: colors.text,
        textTransform: 'capitalize',
        whiteSpace: 'nowrap',
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
