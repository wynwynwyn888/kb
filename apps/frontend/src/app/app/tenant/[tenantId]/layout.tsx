import { TenantWorkspaceGate } from '@/components/app/TenantWorkspaceGate';
import { TenantWorkspaceChrome } from '@/components/app/TenantWorkspaceChrome';

export default function TenantSegmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantId: string };
}) {
  const tenantId =
    typeof params?.tenantId === 'string' && params.tenantId.trim().length > 0 ? params.tenantId.trim() : '';
  return (
    <TenantWorkspaceGate tenantId={tenantId}>
      <TenantWorkspaceChrome tenantId={tenantId}>{children}</TenantWorkspaceChrome>
    </TenantWorkspaceGate>
  );
}
