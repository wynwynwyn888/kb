'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import {
  ErrorBanner,
  LoadingBlock,
  SuccessBanner,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';

/**
 * Supabase recovery / invite links land here with session tokens in the URL hash.
 * `detectSessionInUrl` on the client picks up the recovery session; this page then
 * lets the user set a new password via `supabase.auth.updateUser({ password })`.
 *
 * The new password never leaves the browser — it goes directly to Supabase Auth
 * over HTTPS using the anon client; the backend is not involved.
 */

const MIN_PASSWORD_LENGTH = 8;

export default function AuthResetPasswordLandingPage() {
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

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

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr('');
    if (!password) {
      setErr('Enter a new password.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErr(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErr(error.message || 'Could not update password. The reset link may have expired.');
        return;
      }
      setDone(true);
      setPassword('');
      setConfirm('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <div style={{ minHeight: '50vh', padding: '2rem 1.25rem', maxWidth: 560, margin: '0 auto' }}>
        <LoadingBlock message="Processing reset link…" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '60vh', padding: '2rem 1.25rem', maxWidth: 480, margin: '0 auto', lineHeight: 1.55 }}>
      <h1 style={{ fontSize: '1.35rem', margin: '0 0 0.5rem' }}>Set a new password</h1>

      {!hasSession ? (
        <>
          <ErrorBanner message="This reset link is invalid or expired. Please request a new one." />
          <p style={{ marginTop: '1.25rem' }}>
            <Link href="/login" style={{ color: 'var(--aisbp-accent, #2563eb)', fontWeight: 600 }}>
              Back to sign in
            </Link>
          </p>
        </>
      ) : done ? (
        <>
          <SuccessBanner message="Password updated. You can now sign in with your new password." />
          <p style={{ marginTop: '1.25rem' }}>
            <Link
              href="/login"
              style={{ ...mvpPrimaryButtonStyle, display: 'inline-block', textDecoration: 'none' }}
            >
              Go to sign in
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-text-secondary, #334155)' }}>
            Choose a new password for your account. After updating, you can sign in again on any device.
          </p>

          {err ? <ErrorBanner message={err} /> : null}

          <label style={mvpLabelStyle}>
            New password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={submitting}
              style={mvpInputStyle}
            />
          </label>

          <label style={mvpLabelStyle}>
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={submitting}
              style={mvpInputStyle}
            />
          </label>

          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={submitting || !password || !confirm}
              style={{
                ...mvpPrimaryButtonStyle,
                opacity: submitting || !password || !confirm ? 0.7 : 1,
              }}
            >
              {submitting ? 'Updating…' : 'Update password'}
            </button>
            <Link href="/login" style={{ color: 'var(--aisbp-accent, #2563eb)', fontWeight: 600, fontSize: '0.9rem' }}>
              Back to sign in
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
