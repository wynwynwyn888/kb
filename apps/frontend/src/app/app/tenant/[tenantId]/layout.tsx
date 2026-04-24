import { TenantWorkspaceGate } from '@/components/app/TenantWorkspaceGate';
import { TenantWorkspaceChrome } from '@/components/app/TenantWorkspaceChrome';

export default function TenantSegmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantId: string };
}) {
  return (
    <TenantWorkspaceGate tenantId={params.tenantId}>
      <TenantWorkspaceChrome tenantId={params.tenantId}>{children}</TenantWorkspaceChrome>
    </TenantWorkspaceGate>
  );
}
