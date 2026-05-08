import { redirect } from 'next/navigation';

/** Legacy `/assistant/test-bot` → `/assistant/preview` */
export default function TenantAssistantTestBotRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/assistant/preview`);
}
