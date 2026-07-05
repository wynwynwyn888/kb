import { redirect } from 'next/navigation';

/** Legacy `/assistant/test-bot` → `/assistant/instructions` */
export default function TenantAssistantTestBotRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/assistant/instructions`);
}
