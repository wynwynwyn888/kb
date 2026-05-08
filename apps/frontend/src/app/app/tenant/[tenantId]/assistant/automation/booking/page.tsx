import { redirect } from 'next/navigation';

/** Legacy `/assistant/automation/booking` → `/automation/booking` */
export default function LegacyAssistantAutomationBookingRedirectPage({ params }: { params: { tenantId: string } }) {
  redirect(`/app/tenant/${params.tenantId}/automation/booking`);
}
