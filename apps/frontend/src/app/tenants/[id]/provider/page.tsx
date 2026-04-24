import { redirect } from 'next/navigation';

/** Legacy provider form → agency AI settings (tenant defaults are agency-scoped in this MVP). */
export default function LegacyTenantProviderRedirect() {
  redirect('/app/agency/settings/ai');
}
