'use client';

import { formatDisplayLabel } from '@/lib/identifiers';

export function IdentifierLabel({ businessName, clientKey }: { businessName: string; clientKey: string }) {
  return (
    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--aisbp-text, #0f172a)' }}>
      {formatDisplayLabel(businessName, clientKey)}
    </span>
  );
}
