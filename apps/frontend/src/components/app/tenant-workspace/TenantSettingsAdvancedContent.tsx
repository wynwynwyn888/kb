'use client';

import { KeyValueRows, SectionCard } from '@/components/app/mvp-ui';
import { useTenantSettings } from './tenant-settings-context';

export function TenantSettingsAdvancedContent() {
  const { tenantId, tenantName } = useTenantSettings();

  return (
    <SectionCard title="Advanced identifiers" subtitle="For support and troubleshooting.">
      <KeyValueRows
        rows={[
          { label: 'Workspace name', value: tenantName ?? '—' },
          { label: 'Workspace ID', value: tenantId, mono: true },
        ]}
      />
    </SectionCard>
  );
}
