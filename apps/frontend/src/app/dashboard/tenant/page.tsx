import { redirect } from 'next/navigation';

/** Legacy `/dashboard/tenant` → `/app` (resolves tenant vs agency by session). */
export default function LegacyTenantDashboardRedirect() {
  redirect('/app');
}
