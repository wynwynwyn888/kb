import { redirect } from 'next/navigation';

export default function LegacyBotInstructionsPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/assistant/instructions`);
}
