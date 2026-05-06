'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  PageHeader,
  SectionCard,
  appFloatingPrimaryButtonStyle,
  appFloatingSecondaryButtonStyle,
} from '@/components/app/mvp-ui';

/**
 * Shown when the signed-in user belongs to both an agency and a subaccount (membership on both).
 * `/app` redirects here so we never silently pick the wrong workspace.
 */
export default function WorkspaceChooserPage() {
  const { user } = useAuth();

  if (!user?.agencyRole || !user.tenantId) {
    return (
      <div>
        <PageHeader title="Workspace" eyebrow="Control Center" />
        <p style={{ color: '#666', fontSize: '0.9rem' }}>
          This screen is only for accounts that can access both the agency account and a client workspace.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Choose workspace" eyebrow="Control Center" />
      <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1.25rem', lineHeight: 1.5 }}>
        Your account can access the agency account and a client workspace. Pick where you want to work; you can switch anytime
        from the sidebar.
      </p>
      <SectionCard title="Agency account" subtitle="Control Center, client workspaces, CRM, AI provider, credits, Global Prompt, and team.">
        <Link href="/app/agency" style={appFloatingPrimaryButtonStyle}>
          Open agency account
        </Link>
      </SectionCard>
      <SectionCard title="Client workspace" subtitle="Assistant, knowledge vaults, usage, team, and control panel.">
        <Link href={`/app/tenant/${user.tenantId}/control-panel`} style={appFloatingSecondaryButtonStyle}>
          Open client workspace
        </Link>
      </SectionCard>
    </div>
  );
}
