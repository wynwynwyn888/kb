import { redirect } from 'next/navigation';

/** Legacy URL: bot goals live under `/goals`. */
export default function TenantBotRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/goals`);
}
