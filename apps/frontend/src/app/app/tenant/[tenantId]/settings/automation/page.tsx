import { redirect } from 'next/navigation';

/** Legacy settings → automation URL */
export default function TenantSettingsAutomationRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/assistant/automation/tags`);
}
