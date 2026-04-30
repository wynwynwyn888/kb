import { redirect } from 'next/navigation';

/** Automation moved to top-level nav: /app/tenant/[tenantId]/automation */
export default function TenantSettingsAutomationRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/automation/tags`);
}
