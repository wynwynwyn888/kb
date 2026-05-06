import { redirect } from 'next/navigation';

export default function LegacyTenantSettingsPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/control-panel`);
}
