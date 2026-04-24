'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { LoginSessionAlert } from '../../components/app/LoginSessionAlert';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.replace('/app');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '100px auto', padding: '2rem' }}>
      <h1 style={{ marginBottom: '0.35rem' }}>Sign in</h1>
      <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.95rem' }}>
        Staff access to the control panel. Use your org account (local demo list below if available).
      </p>

      <Suspense fallback={null}>
        <LoginSessionAlert />
      </Suspense>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <label htmlFor="email" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="username"
            disabled={loading}
            style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label htmlFor="password" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            disabled={loading}
            style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', boxSizing: 'border-box' }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{ color: '#8b1d1d', padding: '0.75rem', backgroundColor: '#fde8e8', borderRadius: '6px', border: '1px solid #f5c2c7' }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '0.75rem',
            fontSize: '1rem',
            backgroundColor: loading ? '#ccc' : '#0070f3',
            color: 'white',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            borderRadius: '6px',
          }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '1.25rem', lineHeight: 1.45 }}>
        Sign-in goes through <strong>Supabase Auth</strong>, not this screen directly. If you see a network error, ensure
        Supabase is running locally (CLI) or your <code style={{ fontSize: '0.75rem' }}>.env.local</code> points at the
        project where these users exist.
      </p>

      <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f5f5f5', fontSize: '0.875rem', borderRadius: '8px' }}>
        <strong>Demo accounts (when seeded)</strong>
        <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
          <li>agency-admin@demo.aisbp.com / Demo123!</li>
          <li>tenant-a-admin@demo.aisbp.com / Demo123!</li>
        </ul>
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: '#555', lineHeight: 1.45 }}>
          If login says <strong>invalid credentials</strong> (and the network tab shows a 400 on Supabase token), those
          users are not in Auth yet. This repo does not use <code style={{ fontSize: '0.72rem' }}>prisma db seed</code>{' '}
          — run from the repo root:{' '}
          <code style={{ fontSize: '0.72rem' }}>npx pnpm --filter @aisbp/backend run db:seed</code> with{' '}
          <code style={{ fontSize: '0.72rem' }}>DATABASE_URL</code>, <code style={{ fontSize: '0.72rem' }}>SUPABASE_URL</code>, and{' '}
          <code style={{ fontSize: '0.72rem' }}>SUPABASE_SERVICE_ROLE_KEY</code> set for the same project as{' '}
          <code style={{ fontSize: '0.72rem' }}>.env.local</code>.
        </p>
      </div>
    </div>
  );
}
