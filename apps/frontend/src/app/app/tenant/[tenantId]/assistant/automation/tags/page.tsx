import { redirect } from 'next/navigation';

/** Legacy `/assistant/automation/tags` → `/automation/tagging` */
export default function LegacyAssistantAutomationTagsRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/automation/tagging`);
}
