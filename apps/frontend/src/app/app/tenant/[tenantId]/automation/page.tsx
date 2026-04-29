import { redirect } from 'next/navigation';

/** @deprecated Use Settings → Automation */
export default function LegacyAutomationRedirect({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/settings/automation`);
}
