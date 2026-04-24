import { redirect } from 'next/navigation';

/** Legacy `/dashboard/agency` → `/app/agency`. */
export default function LegacyAgencyDashboardRedirect() {
  redirect('/app/agency');
}
