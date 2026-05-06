import type { ReactNode } from 'react';

/** Legacy `/settings` layout — pages redirect to `/control-panel`. */
export default function LegacyTenantSettingsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
