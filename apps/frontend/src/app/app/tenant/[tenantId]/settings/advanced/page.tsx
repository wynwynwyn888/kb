import { redirect } from 'next/navigation';

export default function LegacyTenantSettingsAdvancedPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/control-panel/advanced`);
}
