'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { LoginSessionAlert } from '../../components/app/LoginSessionAlert';
import { BrandLogo } from '../../components/app/BrandLogo';

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
      <div style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'center' }}>
        <BrandLogo height={40} maxWidth={220} />
      </div>
      <h1 style={{ marginBottom: '0.35rem' }}>Sign in</h1>
      <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.95rem' }}>
        Sign in with the email and password your administrator invited you to use.
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
        Having trouble? Check your internet connection. If your organization just set this up, confirm you were invited
        with the correct email.
      </p>

      <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f5f5f5', fontSize: '0.875rem', borderRadius: '8px' }}>
        <strong>Optional demo sign-in (local evaluation only)</strong>
        <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
          <li>agency-admin@demo.aisbp.com / Demo123!</li>
          <li>tenant-a-admin@demo.aisbp.com / Demo123!</li>
        </ul>
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: '#555', lineHeight: 1.45 }}>
          These only work after an administrator has created them in your environment. If you see “invalid
          credentials,” ask your administrator to provision demo users or send you an invite.
        </p>
        {process.env.NODE_ENV === 'development' ? (
          <details style={{ marginTop: '0.65rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: '#444' }}>Administrator: seed demo data</summary>
            <p style={{ margin: '0.45rem 0 0', fontSize: '0.72rem', color: '#555', lineHeight: 1.5 }}>
              From the repository root, with database and Supabase service credentials configured for this project, run
              the backend seed command your team documents (for example <code>pnpm --filter @aisbp/backend run db:seed</code>
              ). Use the same Supabase project as this app&apos;s environment file.
            </p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
