'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
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
 * Invite emails include `invite_id` + `scope` query params; after password is set we
 * send the user to `/auth/invite` to attach agency/workspace membership.
 */

const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordInner() {
  const router = useRouter();
  const search = useSearchParams();
  const inviteId = search.get('invite_id')?.trim() ?? '';
  const scope = (search.get('scope') ?? '').toLowerCase();
  const isInviteSetup = Boolean(inviteId && (scope === 'agency' || scope === 'workspace'));

  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setHasSession(Boolean(data.session));
        setReady(true);
      }
    };

    void syncSession();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setHasSession(Boolean(session));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
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
        setErr(error.message || 'Could not update password. The link may have expired.');
        return;
      }
      setDone(true);
      setPassword('');
      setConfirm('');
      if (isInviteSetup) {
        const q = new URLSearchParams({ invite_id: inviteId, scope });
        router.replace(`/auth/invite?${q.toString()}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return <LoadingBlock message={isInviteSetup ? 'Preparing your invite…' : 'Processing reset link…'} />;
  }

  const title = isInviteSetup ? 'Create your password' : 'Set a new password';
  const intro = isInviteSetup
    ? 'Choose a password for your account. After saving, we will finish setting up your access.'
    : 'Choose a new password for your account. After updating, you can sign in again on any device.';

  return (
    <>
      <h1 style={{ fontSize: '1.35rem', margin: '0 0 0.5rem' }}>{title}</h1>

      {!hasSession ? (
        <>
          <ErrorBanner
            message={
              isInviteSetup
                ? 'This invite link is invalid or expired. Open the link from your invite email, or ask your admin to send a new invite.'
                : 'This reset link is invalid or expired. Please request a new one.'
            }
          />
          <p style={{ marginTop: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <Link href="/login" style={{ color: 'var(--aisbp-accent, #2563eb)', fontWeight: 600 }}>
              Back to sign in
            </Link>
            {!isInviteSetup ? (
              <Link href="/auth/forgot-password" style={{ color: 'var(--aisbp-accent, #2563eb)', fontWeight: 600 }}>
                Request a new reset link
              </Link>
            ) : null}
          </p>
        </>
      ) : done && !isInviteSetup ? (
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
      ) : done && isInviteSetup ? (
        <LoadingBlock message="Finishing your invite…" />
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-text-secondary, #334155)' }}>{intro}</p>

          {err ? <ErrorBanner message={err} /> : null}

          <label style={mvpLabelStyle}>
            {isInviteSetup ? 'Password' : 'New password'}
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

          <SubmitActions submitting={submitting} password={password} confirm={confirm} isInviteSetup={isInviteSetup} />
        </form>
      )}
    </>
  );
}

function SubmitActions({
  submitting,
  password,
  confirm,
  isInviteSetup,
}: {
  submitting: boolean;
  password: string;
  confirm: string;
  isInviteSetup: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type="submit"
        disabled={submitting || !password || !confirm}
        style={{
          ...mvpPrimaryButtonStyle,
          opacity: submitting || !password || !confirm ? 0.7 : 1,
        }}
      >
        {submitting ? 'Saving…' : isInviteSetup ? 'Save password & continue' : 'Update password'}
      </button>
      <Link href="/login" style={{ color: 'var(--aisbp-accent, #2563eb)', fontWeight: 600, fontSize: '0.9rem' }}>
        Back to sign in
      </Link>
    </div>
  );
}

export default function AuthResetPasswordLandingPage() {
  return (
    <div style={{ minHeight: '60vh', padding: '2rem 1.25rem', maxWidth: 480, margin: '0 auto', lineHeight: 1.55 }}>
      <Suspense fallback={<LoadingBlock message="Loading…" />}>
        <ResetPasswordInner />
      </Suspense>
    </div>
  );
}

