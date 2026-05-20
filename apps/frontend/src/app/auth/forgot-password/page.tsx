'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import {
  ErrorBanner,
  SuccessBanner,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';

function resolveResetRedirectUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/auth/reset-password`;
  }
  const base = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}/auth/reset-password` : '/auth/reset-password';
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: resolveResetRedirectUrl(),
      });
      if (error) {
        setErr(error.message || 'Could not send reset email.');
        return;
      }
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '60vh', padding: '2rem 1.25rem', maxWidth: 480, margin: '0 auto', lineHeight: 1.55 }}>
      <h1 style={{ fontSize: '1.35rem', margin: '0 0 0.5rem' }}>Forgot password</h1>
      <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--aisbp-text-secondary, #334155)' }}>
        Enter the email on your account. We will send a link to reset your password.
      </p>

      {sent ? (
        <>
          <SuccessBanner message="If an account exists for that email, a reset link has been sent. Check your inbox." />
          <p style={{ marginTop: '1.25rem' }}>
            <Link href="/login" style={{ color: 'var(--aisbp-accent, #2563eb)', fontWeight: 600 }}>
              Back to sign in
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {err ? <ErrorBanner message={err} /> : null}

          <label style={mvpLabelStyle}>
            Email
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              required
              disabled={submitting}
              style={mvpInputStyle}
            />
          </label>

          <button
            type="submit"
            disabled={submitting || !email.trim()}
            style={{
              ...mvpPrimaryButtonStyle,
              opacity: submitting || !email.trim() ? 0.7 : 1,
            }}
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>

          <Link href="/login" style={{ color: 'var(--aisbp-accent, #2563eb)', fontWeight: 600, fontSize: '0.9rem' }}>
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  );
}
