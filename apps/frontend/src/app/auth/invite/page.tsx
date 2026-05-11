'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { acceptAgencyInvite, acceptWorkspaceInvite, isApiHttpError } from '@/lib/api';
import { ErrorBanner, LoadingBlock, SuccessBanner, mvpPrimaryButtonStyle, mvpSecondaryButtonStyle } from '@/components/app/mvp-ui';

function mapInviteAcceptError(err: unknown): string {
  if (isApiHttpError(err)) {
    const raw = err.message || '';
    if (err.status === 403) {
      if (/This invite was sent to/i.test(raw)) return raw;
      return raw || 'You are not allowed to accept this invite with the current session.';
    }
    if (err.status === 404) {
      return 'This invite is invalid or expired. Ask your admin to send a new invite.';
    }
    if (err.status === 410) {
      return 'This invite is invalid or expired. Ask your admin to send a new invite.';
    }
    if (err.status === 400) {
      if (/We could not attach this account to the invite/i.test(raw)) {
        return 'We could not attach this account to the invite. Please contact support.';
      }
      return raw || 'Could not accept invite.';
    }
    if (err.status === 401) {
      return raw || 'Your session is no longer valid. Sign out and sign in again.';
    }
    return raw || 'Could not accept invite.';
  }
  return err instanceof Error ? err.message : 'Could not accept invite.';
}

function InviteAcceptInner() {
  const search = useSearchParams();
  const inviteId = search.get('invite_id')?.trim() ?? '';
  const scope = (search.get('scope') ?? '').toLowerCase();
  const { token, loading, refreshUser, logout } = useAuth();
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);

  useEffect(() => {
    if (!inviteId || (scope !== 'agency' && scope !== 'workspace')) {
      setErr('This invite link is missing required details. Ask your admin for a new invite.');
      return;
    }
    if (loading || !token || done) return;

    let cancelled = false;
    (async () => {
      setBusy(true);
      setErr('');
      try {
        if (scope === 'agency') {
          await acceptAgencyInvite(token, inviteId);
        } else {
          await acceptWorkspaceInvite(token, inviteId);
        }
        if (cancelled) return;
        setOk('Invite accepted. Your access is updated.');
        setDone(true);
        await refreshUser();
      } catch (e) {
        if (!cancelled) setErr(mapInviteAcceptError(e));
      } finally {
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteId, scope, token, loading, done, retrySeq, refreshUser]);

  const onRetry = () => {
    setErr('');
    setOk('');
    setDone(false);
    setRetrySeq(s => s + 1);
  };

  if (!inviteId || (scope !== 'agency' && scope !== 'workspace')) {
    return <ErrorBanner message={err || 'Invalid invite link.'} />;
  }

  if (loading && !token) {
    return <LoadingBlock message="Checking your session…" />;
  }

  if (!loading && !token) {
    return (
      <div style={{ maxWidth: 480, lineHeight: 1.55 }}>
        <p style={{ fontSize: '0.95rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.75rem' }}>
          Sign in with the email address that received the invite, then open this page again (or complete the steps from the
          invite link you were sent first).
        </p>
        <Link href="/login" style={{ ...mvpPrimaryButtonStyle, display: 'inline-block', textDecoration: 'none' }}>
          Go to sign in
        </Link>
      </div>
    );
  }

  const showErrorActions = Boolean(err) && !done;

  return (
    <div style={{ maxWidth: 520 }}>
      {err ? <ErrorBanner message={err} /> : null}
      {ok ? <SuccessBanner message={ok} /> : null}
      {busy ? <LoadingBlock message="Finishing invite…" /> : null}
      {showErrorActions ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" onClick={() => void onRetry()} style={mvpPrimaryButtonStyle}>
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            style={mvpSecondaryButtonStyle}
          >
            Sign out
          </button>
          <Link href="/login" style={{ ...mvpSecondaryButtonStyle, display: 'inline-block', textDecoration: 'none' }}>
            Go to login
          </Link>
        </div>
      ) : null}
      {done ? (
        <p style={{ marginTop: '1rem' }}>
          <Link href="/app" style={{ ...mvpPrimaryButtonStyle, display: 'inline-block', textDecoration: 'none' }}>
            Continue to app
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <div style={{ minHeight: '60vh', padding: '2rem 1.25rem', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.35rem', margin: '0 0 0.5rem' }}>Accept invite</h1>
      <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 1.25rem' }}>
        We attach your account to the agency or workspace after you are signed in.
      </p>
      <Suspense fallback={<LoadingBlock message="Loading…" />}>
        <InviteAcceptInner />
      </Suspense>
    </div>
  );
}
