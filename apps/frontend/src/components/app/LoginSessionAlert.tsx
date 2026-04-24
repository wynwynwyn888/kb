'use client';

import { useSearchParams } from 'next/navigation';
import { ErrorBanner } from '@/components/app/mvp-ui';

/** Shows after API 401 redirect or explicit session query. */
export function LoginSessionAlert() {
  const params = useSearchParams();
  const session = params.get('session');
  if (session === 'expired') {
    return <ErrorBanner message="Your session expired or is no longer valid. Sign in again." />;
  }
  if (session === 'signedout') {
    return (
      <ErrorBanner message="You’ve been signed out." />
    );
  }
  return null;
}
