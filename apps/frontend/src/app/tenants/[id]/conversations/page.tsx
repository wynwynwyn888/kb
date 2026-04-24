import { redirect } from 'next/navigation';

/** Legacy tenant conversations → tenant hub (read-only MVP). */
export default function LegacyTenantConversationsRedirect({ params }: { params: { id: string } }) {
  redirect(`/app/tenant/${encodeURIComponent(params.id)}/conversations`);
}
