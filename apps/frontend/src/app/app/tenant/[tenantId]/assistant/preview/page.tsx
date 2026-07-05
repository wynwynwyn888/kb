'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function TenantAssistantPreviewRedirect() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params['tenantId'] as string;
  useEffect(() => {
    router.replace(`/app/tenant/${tenantId}/assistant/instructions`);
  }, [tenantId, router]);
  return null;
}
