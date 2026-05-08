import { redirect } from 'next/navigation';

/** Tenant root: land on Bot (IA hub) instead of a separate overview. */
export default function TenantRootPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/assistant/profiles`);
}
