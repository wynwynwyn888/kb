'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { LoginSessionAlert } from '../../components/app/LoginSessionAlert';
import { BrandLogo } from '../../components/app/BrandLogo';
import { ThemeToggle } from '../../components/app/ThemeToggle';
import { mvpInputStyle, mvpLabelStyle, mvpPrimaryButtonStyle } from '../../components/app/mvp-ui';

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
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        background:
          'radial-gradient(1200px 600px at 15% 10%, rgba(15, 98, 254, 0.12), transparent 55%), radial-gradient(900px 520px at 80% 20%, rgba(34, 197, 94, 0.10), transparent 55%), var(--aisbp-bg, #f8fafc)',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 'clamp(1rem, 3vw, 1.5rem)',
          right: 'clamp(1rem, 3vw, 1.5rem)',
          zIndex: 2,
        }}
      >
        <ThemeToggle />
      </div>
      <div
        style={{
          width: 'min(1100px, 100%)',
          margin: '0 auto',
          padding: 'clamp(1.25rem, 3vw, 2.25rem)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'clamp(1.25rem, 3vw, 2.25rem)',
          alignItems: 'center',
        }}
      >
        <div style={{ padding: '0.5rem 0' }}>
          <div style={{ marginBottom: '1rem' }}>
            <BrandLogo height={40} maxWidth={220} />
          </div>
          <h1
            style={{
              margin: '0 0 0.65rem',
              fontSize: 'clamp(1.75rem, 2.5vw, 2.25rem)',
              letterSpacing: '-0.02em',
              color: 'var(--aisbp-text-heading, #0f172a)',
            }}
          >
            Sign in to AISalesBot Pro
          </h1>
          <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.6, color: 'var(--aisbp-muted, #475569)', maxWidth: 520 }}>
            Manage your Assistant, Automation, Knowledge Vaults, and Credits from one clean workspace connected to your CRM.
          </p>
        </div>

        <div
          style={{
            border: '1px solid var(--aisbp-glass-border, rgba(226, 232, 240, 0.9))',
            background: 'var(--aisbp-glass-bg, rgba(255, 255, 255, 0.75))',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            borderRadius: 18,
            boxShadow: '0 18px 50px rgba(15, 23, 42, 0.10)',
            padding: '1.35rem 1.35rem 1.15rem',
            maxWidth: 480,
            justifySelf: 'end',
            width: '100%',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)', lineHeight: 1.5 }}>
            Use the email and password your admin invited you with.
          </p>

          <div style={{ marginTop: '0.85rem' }}>
            <Suspense fallback={null}>
              <LoginSessionAlert />
            </Suspense>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginTop: '0.9rem' }}>
            <div>
              <label htmlFor="email" style={{ ...mvpLabelStyle, display: 'block', marginBottom: '0.35rem' }}>
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
                style={{
                  ...mvpInputStyle,
                  width: '100%',
                  padding: '0.75rem 0.8rem',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  borderRadius: 10,
                }}
              />
            </div>

            <div>
                <label htmlFor="password" style={{ ...mvpLabelStyle, display: 'block', marginBottom: '0.35rem' }}>
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
                style={{
                  ...mvpInputStyle,
                  width: '100%',
                  padding: '0.75rem 0.8rem',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  borderRadius: 10,
                }}
              />
              <p style={{ margin: '0.45rem 0 0', textAlign: 'right' }}>
                <Link
                  href="/auth/forgot-password"
                  style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--aisbp-accent, #2563eb)' }}
                >
                  Forgot password?
                </Link>
              </p>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  color: 'var(--aisbp-alert-error-fg, #8b1d1d)',
                  padding: '0.75rem',
                  backgroundColor: 'var(--aisbp-alert-error-bg, #fde8e8)',
                  borderRadius: '10px',
                  border: '1px solid var(--aisbp-alert-error-border, #f5c2c7)',
                  fontSize: '0.9rem',
                  lineHeight: 1.45,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                ...mvpPrimaryButtonStyle,
                padding: '0.8rem 0.95rem',
                fontSize: '1rem',
                fontWeight: 700,
                borderRadius: 12,
                boxShadow: loading ? 'none' : '0 10px 26px rgba(15, 98, 254, 0.22)',
                opacity: loading ? 0.85 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: '1.1rem 0 0', lineHeight: 1.55 }}>
            Need access? Contact your workspace admin.
          </p>
        </div>
      </div>
    </div>
  );
}
