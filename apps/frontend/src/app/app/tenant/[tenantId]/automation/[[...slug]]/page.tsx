import { redirect } from 'next/navigation';

/** Legacy `/automation/*` → `/assistant/automation/*` */
export default function LegacyAutomationRedirect({
  params,
}: {
  params: { tenantId: string; slug?: string[] };
}) {
  const tail = params.slug?.length ? params.slug.join('/') : 'tags';
  redirect(`/app/tenant/${params.tenantId}/assistant/automation/${tail}`);
}
