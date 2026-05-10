'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { LoadingBlock, SuccessBanner, mvpPrimaryButtonStyle } from '@/components/app/mvp-ui';

/**
 * Supabase recovery / invite links often land here with session tokens in the URL hash.
 * `detectSessionInUrl` on the client picks up the session; this page confirms and routes onward.
 */
export default function AuthResetPasswordLandingPage() {
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setHasSession(Boolean(data.session));
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div style={{ minHeight: '50vh', padding: '2rem 1.25rem', maxWidth: 560, margin: '0 auto' }}>
        <LoadingBlock message="Processing reset link…" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '60vh', padding: '2rem 1.25rem', maxWidth: 560, margin: '0 auto', lineHeight: 1.55 }}>
      <h1 style={{ fontSize: '1.35rem', margin: '0 0 0.5rem' }}>Password reset</h1>
      {hasSession ? (
        <>
          <SuccessBanner message="Your session is active. You can continue to the app or sign in again from another device." />
          <p style={{ marginTop: '1rem' }}>
            <Link href="/app" style={{ ...mvpPrimaryButtonStyle, display: 'inline-block', textDecoration: 'none' }}>
              Continue to app
            </Link>
          </p>
        </>
      ) : (
        <p style={{ fontSize: '0.92rem', color: 'var(--aisbp-text-secondary, #334155)', margin: 0 }}>
          If you opened a password reset link from email, follow the steps in that email first. When you land back here with an
          active session, you can continue. Otherwise use sign in with your new password.
        </p>
      )}
      <p style={{ marginTop: '1.25rem' }}>
        <Link href="/login" style={{ color: 'var(--aisbp-accent, #2563eb)', fontWeight: 600 }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
