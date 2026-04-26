'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace('/app');
      } else {
        router.replace('/login');
      }
    }
  }, [user, loading, router]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div style={{ padding: '2rem', textAlign: 'center', maxWidth: '28rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 1rem' }}>Redirecting…</p>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
        <a href="/login" style={{ color: '#2563eb', fontWeight: 600 }}>
          Open sign-in
        </a>
        <span style={{ color: '#94a3b8', margin: '0 0.5rem' }}>·</span>
        <a href="/app" style={{ color: '#2563eb', fontWeight: 600 }}>
          Open app
        </a>
      </p>
      {isDev ? (
        <p style={{ margin: '1.25rem 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
          Stuck here after a dev server restart? Hard-refresh this tab (Ctrl+Shift+R), or stop Next and run{' '}
          <code style={{ fontSize: '0.72rem', background: '#f1f5f9', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
            pnpm --filter @aisbp/frontend dev:clean
          </code>{' '}
          so <code style={{ fontSize: '0.72rem' }}>.next</code> matches the running server. If the Network tab shows 404s
          on <code style={{ fontSize: '0.72rem' }}>main-app.js</code> or <code style={{ fontSize: '0.72rem' }}>layout.js</code>, the UI bundle did not load — that is a dev cache issue, not your password.
        </p>
      ) : null}
    </div>
  );
}