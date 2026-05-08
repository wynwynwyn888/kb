import { redirect } from 'next/navigation';

/** Legacy `/assistant/automation/escalation` → `/automation/escalation` */
export default function LegacyAssistantAutomationEscalationRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/automation/escalation`);
}
