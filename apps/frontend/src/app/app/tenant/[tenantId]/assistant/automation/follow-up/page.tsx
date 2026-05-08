import { redirect } from 'next/navigation';

/** Legacy `/assistant/automation/follow-up` → `/automation/follow-up` */
export default function LegacyAssistantAutomationFollowUpRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/automation/follow-up`);
}
