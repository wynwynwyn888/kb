'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, SectionCard } from '@/components/app/mvp-ui';

/**
 * Shown when the signed-in user belongs to both an agency and a subaccount (membership on both).
 * `/app` redirects here so we never silently pick the wrong workspace.
 */
export default function WorkspaceChooserPage() {
  const { user } = useAuth();

  if (!user?.agencyRole || !user.tenantId) {
    return (
      <div>
        <PageHeader title="Workspace" eyebrow="Control panel" />
        <p style={{ color: '#666', fontSize: '0.9rem' }}>
          This screen is only for accounts with both agency staff access and a subaccount assignment. Use{' '}
          <Link href="/app" style={{ color: '#0070f3', fontWeight: 600 }}>
            /app
          </Link>{' '}
          to route to your default workspace.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Choose workspace" eyebrow="Control panel" />
      <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1.25rem', lineHeight: 1.5 }}>
        Your account has <strong>agency</strong> access and a <strong>subaccount</strong> assignment. Pick where you
        want to work; you can switch anytime from the sidebar or by returning to this page via{' '}
        <Link href="/app" style={{ color: '#0070f3', fontWeight: 600 }}>
          /app
        </Link>
        .
      </p>
      <SectionCard title="Agency account" subtitle="Dashboard, subaccounts, integrations, AI settings, reply policy, agency team.">
        <Link
          href="/app/agency"
          style={{
            display: 'inline-block',
            padding: '0.55rem 1rem',
            borderRadius: '6px',
            background: '#0070f3',
            color: '#fff',
            fontWeight: 600,
            textDecoration: 'none',
            fontSize: '0.9rem',
          }}
        >
          Open agency account →
        </Link>
      </SectionCard>
      <SectionCard title="Subaccount" subtitle="Bot, knowledge, usage, team, and more.">
        <Link
          href={`/app/tenant/${user.tenantId}/goals`}
          style={{
            display: 'inline-block',
            padding: '0.55rem 1rem',
            borderRadius: '6px',
            background: '#111',
            color: '#fff',
            fontWeight: 600,
            textDecoration: 'none',
            fontSize: '0.9rem',
          }}
        >
          Open subaccount workspace →
        </Link>
      </SectionCard>
    </div>
  );
}
