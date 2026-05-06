import { redirect } from 'next/navigation';

export default function TenantAutomationIndexPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/assistant/automation/tags`);
}
