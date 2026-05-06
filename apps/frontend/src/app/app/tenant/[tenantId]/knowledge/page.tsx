import { redirect } from 'next/navigation';

export default function LegacyKnowledgePage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/knowledge-vaults`);
}
