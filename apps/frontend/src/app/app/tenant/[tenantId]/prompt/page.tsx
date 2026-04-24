import { redirect } from 'next/navigation';

/** Legacy route: prompt editing lives under Goals. */
export default function TenantPromptRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/goals`);
}
