import type { ReactNode } from 'react';

export function MvpHonesty({ children }: { children?: ReactNode }) {
  return (
    <p
      style={{
        fontSize: '0.85rem',
        color: '#555',
        borderLeft: '3px solid #f5a623',
        paddingLeft: '0.75rem',
        marginBottom: '1rem',
        lineHeight: 1.45,
      }}
    >
      {children ??
        'Internal control panel for this AI stack — use it to configure and inspect behavior, not as a bulk outbound or marketing tool.'}
    </p>
  );
}
