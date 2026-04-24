import { redirect } from 'next/navigation';

/** Legacy `/tenants` switcher placeholder → `/app`. */
export default function LegacyTenantsRedirect() {
  redirect('/app');
}
