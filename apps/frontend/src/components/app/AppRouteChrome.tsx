'use client';

import type { ReactNode } from 'react';
import React from 'react';
import { CHUNK_RELOAD_STORAGE_PREFIX, isProbablyChunkLoadError } from '@/lib/chunk-load-recovery';
import { AppShell } from '@/components/app/AppShell';

interface State {
  error: Error | null;
}

/** Catches subtree render errors — recovers stale chunk hashes via a single reload. */
export class ChunkLoadRecoveryBoundary extends React.Component<{ children: ReactNode }, State> {
  declare state: State;

  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const e =
      error instanceof Error
        ? error
        : error != null
          ? new Error(String(error))
          : new Error('Unknown render error');
    return { error: e };
  }

  override componentDidCatch(error: unknown) {
    if (!isProbablyChunkLoadError(error) || typeof window === 'undefined') return;
    try {
      const key = `${CHUNK_RELOAD_STORAGE_PREFIX}:${window.location.pathname}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      window.location.reload();
    } catch {
      /* ignore */
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunkLike = isProbablyChunkLoadError(error);
    let alreadyRetried = false;
    if (typeof window !== 'undefined') {
      try {
        alreadyRetried = Boolean(sessionStorage.getItem(`${CHUNK_RELOAD_STORAGE_PREFIX}:${window.location.pathname}`));
      } catch {
        alreadyRetried = false;
      }
    }

    if (chunkLike && alreadyRetried) {
      return (
        <div
          style={{
            padding: '2rem',
            maxWidth: 520,
            margin: '0 auto',
            fontFamily: 'system-ui, sans-serif',
            background: '#f8fafc',
            minHeight: '100vh',
            boxSizing: 'border-box',
          }}
        >
          <p style={{ marginTop: 0, fontWeight: 700 }}>Assets out of sync</p>
          <p style={{ color: '#475569', fontSize: '0.95rem', lineHeight: 1.5 }}>
            A cached page referenced an older app bundle. Please refresh once to load the latest version.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 0.95rem',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#0f172a',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Refresh page
          </button>
        </div>
      );
    }

    /* Non-chunk or first chunk failure mid-retry — keep Next.js-style minimal fallback */
    return (
      <div
        style={{
          padding: '2rem',
          maxWidth: 520,
          margin: '0 auto',
          fontFamily: 'system-ui, sans-serif',
          background: '#f8fafc',
          minHeight: '100vh',
          boxSizing: 'border-box',
        }}
      >
        <p style={{ marginTop: 0, fontWeight: 700 }}>Something went wrong</p>
        <p style={{ color: '#475569', fontSize: '0.95rem', lineHeight: 1.5 }}>
          Try refreshing this page. If the problem persists, contact your workspace admin.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 0.95rem',
            borderRadius: 8,
            border: '1px solid #cbd5e1',
            background: '#fff',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Refresh page
        </button>
      </div>
    );
  }
}

export default function AppRouteChrome({ children }: { children: ReactNode }) {
  return (
    <ChunkLoadRecoveryBoundary>
      <AppShell>{children}</AppShell>
    </ChunkLoadRecoveryBoundary>
  );
}
