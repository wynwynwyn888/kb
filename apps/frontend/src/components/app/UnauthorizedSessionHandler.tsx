'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { API_UNAUTHORIZED_EVENT } from '@/lib/api';

/**
 * Listens for API 401 responses and signs out, then redirects to login with a clear query hint.
 */
export function UnauthorizedSessionHandler() {
  const { logout } = useAuth();
  const router = useRouter();
  const handling = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (handling.current) return;
      handling.current = true;
      try {
        await logout();
        router.replace('/login?session=expired');
      } finally {
        handling.current = false;
      }
    };

    const onUnauthorized = () => {
      void run();
    };

    window.addEventListener(API_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, onUnauthorized);
  }, [logout, router]);

  return null;
}
