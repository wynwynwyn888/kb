import { redirect } from 'next/navigation';

/** Legacy tenant settings (GHL) → agency-managed GHL connection UI. */
export default function LegacyTenantSettingsRedirect({ params }: { params: { id: string } }) {
  redirect(`/app/agency/settings/ghl?subaccount=${encodeURIComponent(params.id)}`);
}
