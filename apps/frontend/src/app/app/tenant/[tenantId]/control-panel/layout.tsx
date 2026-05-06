'use client';

import { TenantSettingsProvider } from '@/components/app/tenant-workspace/tenant-settings-context';
import { TenantSettingsShell } from '@/components/app/tenant-workspace/TenantSettingsShell';

export default function TenantControlPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantSettingsProvider>
      <TenantSettingsShell>{children}</TenantSettingsShell>
    </TenantSettingsProvider>
  );
}
