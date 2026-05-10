'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { acceptAgencyInvite, acceptWorkspaceInvite } from '@/lib/api';
import { ErrorBanner, LoadingBlock, SuccessBanner, mvpPrimaryButtonStyle } from '@/components/app/mvp-ui';

function InviteAcceptInner() {
  const search = useSearchParams();
  const inviteId = search.get('invite_id')?.trim() ?? '';
  const scope = (search.get('scope') ?? '').toLowerCase();
  const { token, loading, refreshUser } = useAuth();
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!inviteId || (scope !== 'agency' && scope !== 'workspace')) {
      setErr('This invite link is missing required details. Ask your admin for a new invite.');
      return;
    }
    if (loading || !token || done || attempted) return;

    let cancelled = false;
    (async () => {
      setAttempted(true);
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
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not accept invite');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteId, scope, token, loading, done, attempted, refreshUser]);

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

  return (
    <div style={{ maxWidth: 520 }}>
      {err ? <ErrorBanner message={err} /> : null}
      {ok ? <SuccessBanner message={ok} /> : null}
      {busy ? <LoadingBlock message="Finishing invite…" /> : null}
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
