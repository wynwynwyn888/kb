import { redirect } from 'next/navigation';

export default function TenantAssistantOverviewPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/assistant/profiles`);
}
