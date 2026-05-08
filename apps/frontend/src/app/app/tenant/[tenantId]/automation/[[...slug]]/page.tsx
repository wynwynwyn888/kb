import { redirect } from 'next/navigation';

/** Legacy `/automation/*` → `/automation/*` (workspace-scoped) */
export default function LegacyAutomationRedirect({
  params,
}: {
  params: { tenantId: string; slug?: string[] };
}) {
  const tailRaw = params.slug?.length ? params.slug.join('/') : 'tagging';
  const tail = tailRaw === 'tags' ? 'tagging' : tailRaw;
  redirect(`/app/tenant/${params.tenantId}/automation/${tail}`);
}
