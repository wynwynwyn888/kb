import { redirect } from 'next/navigation';

/** Legacy route — goals editing lives under Assistant → Instructions. */
export default function LegacyTenantGoalsPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/assistant/instructions`);
}
