import { redirect } from 'next/navigation';

/** Legacy `/automation/tags` → `/automation/tagging` */
export default function TenantAutomationTagsRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/automation/tagging`);
}

