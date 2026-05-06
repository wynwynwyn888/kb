'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { AutomationWorkspaceLayout } from '@/components/app/tenant-workspace/AutomationWorkspaceLayout';

export default function TenantAutomationLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  return <AutomationWorkspaceLayout tenantId={tenantId}>{children}</AutomationWorkspaceLayout>;
}
