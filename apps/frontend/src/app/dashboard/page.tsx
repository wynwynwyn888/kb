import { redirect } from 'next/navigation';

/** Legacy `/dashboard` → canonical workspace entry at `/app`. */
export default function LegacyDashboardRedirect() {
  redirect('/app');
}
