'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import {
  ErrorBanner,
  LoadingBlock,
  StatusPill,
  appFloatingPrimaryButtonStyle,
  appFloatingSecondaryButtonStyle,
} from '@/components/app/mvp-ui';
import {
  assistantProfileSetupLabel,
  clientAiRepliesShortLabel,
  clientCrmStatusSummary,
  replyStyleLabelFromTemperature,
} from '@/lib/workspace-settings-display';
import { useTenantSettings } from './tenant-settings-context';

const tabLinkStyle = (active: boolean): CSSProperties => ({
  padding: '0.45rem 0.85rem',
  borderRadius: '10px',
  border: active ? '1px solid var(--aisbp-border, #e2e8f0)' : '1px solid transparent',
  background: active ? 'var(--aisbp-surface, #fff)' : 'transparent',
  fontWeight: active ? 700 : 600,
  fontSize: '0.85rem',
  color: active ? 'var(--aisbp-text-heading, #0f172a)' : 'var(--aisbp-muted, #64748b)',
  textDecoration: 'none',
  display: 'inline-block',
});

const statTile: CSSProperties = {
  padding: '0.55rem 0.75rem',
  borderRadius: 12,
  background: 'var(--aisbp-stat-tile-bg, #f8fafc)',
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  minWidth: '6.5rem',
};

export function TenantSettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const {
    base,
    loading,
    err,
    reload,
    tenantName,
    botMode,
    promptConfigSnap,
    ghl,
    ghlLoadErr,
    canRenameWorkspace,
  } = useTenantSettings();

  const settingsRoot = `${base}/settings`;
  const isGeneral = pathname === settingsRoot || pathname === `${settingsRoot}/`;
  const isAdvanced = pathname.startsWith(`${settingsRoot}/advanced`);

  const aiShort = clientAiRepliesShortLabel(botMode);
  const assistantTile = assistantProfileSetupLabel(promptConfigSnap);
  const replyStyleTile =
    promptConfigSnap != null ? replyStyleLabelFromTemperature(Number(promptConfigSnap.temperature)) : '—';
  const crmTile =
    ghlLoadErr ? '—' : ghl ? clientCrmStatusSummary(ghl) : 'Not connected';

  const heroMetaLine = `AI replies: ${aiShort} · Assistant: ${assistantTile}`;

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.25rem' }}>
        <p
          style={{
            fontSize: '0.62rem',
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: 'var(--aisbp-muted, #94a3b8)',
            margin: '0 0 0.35rem',
          }}
        >
          Settings
        </p>
        <h1
          style={{
            fontSize: '1.75rem',
            fontWeight: 800,
            margin: 0,
            color: 'var(--aisbp-text-heading, #0f172a)',
            letterSpacing: '-0.03em',
          }}
        >
          Workspace Settings
        </h1>
        <p
          style={{
            fontSize: '0.875rem',
            color: 'var(--aisbp-muted, #64748b)',
            margin: '0.45rem 0 0',
            lineHeight: 1.55,
            maxWidth: '40rem',
          }}
        >
          See how this workspace is set up: CRM connection, assistant, and automatic replies.
        </p>
      </header>

      {err ? (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorBanner message={err} />
          <button type="button" onClick={() => reload()} style={{ marginTop: '0.5rem', ...appFloatingSecondaryButtonStyle }}>
            Try again
          </button>
        </div>
      ) : null}

      {loading && !err ? <LoadingBlock message="Loading workspace settings…" /> : null}

      {!loading && !err ? (
        <>
          <div
            style={{
              borderRadius: 16,
              marginBottom: '1.25rem',
              padding: '1.2rem 1.25rem 1.25rem',
              background: 'linear-gradient(125deg, #0f172a 0%, #1e293b 100%)',
              color: '#f1f5f9',
              boxShadow: '0 16px 48px rgba(15, 23, 42, 0.28)',
            }}
            aria-label="Workspace overview"
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(148, 163, 184, 0.95)' }}>
                  WORKSPACE
                </div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, margin: '0.25rem 0 0', lineHeight: 1.2 }}>{tenantName ?? 'Workspace'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem', marginTop: '0.65rem' }}>
                  {ghl && !ghlLoadErr && ghl.status === 'CONNECTED' ? <StatusPill label="CRM connected" tone="ok" /> : null}
                  {ghl && !ghlLoadErr && ghl.status !== 'CONNECTED' ? (
                    <StatusPill
                      label={clientCrmStatusSummary(ghl) === 'Not connected' ? 'CRM not connected' : 'CRM needs attention'}
                      tone={ghl.status === 'DISCONNECTED' ? 'neutral' : 'warn'}
                    />
                  ) : null}
                  {!ghl && !ghlLoadErr ? <StatusPill label="CRM not connected" tone="neutral" /> : null}
                </div>
                <p
                  style={{
                    margin: '0.75rem 0 0',
                    fontSize: '0.8rem',
                    color: 'rgba(226, 232, 240, 0.92)',
                    lineHeight: 1.5,
                    maxWidth: '36rem',
                  }}
                >
                  {heroMetaLine}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', alignItems: 'stretch', minWidth: '12rem' }}>
                <Link href={`${base}/goals`} style={{ ...appFloatingPrimaryButtonStyle, textAlign: 'center' as const }}>
                  Bot instructions
                </Link>
                <Link href={`${base}/knowledge`} style={{ ...appFloatingSecondaryButtonStyle, background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#f8fafc', boxShadow: 'none', textAlign: 'center' as const }}>
                  Knowledge base
                </Link>
                <Link href={`${base}/ghl-status`} style={{ ...appFloatingSecondaryButtonStyle, background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#f8fafc', boxShadow: 'none', textAlign: 'center' as const }}>
                  CRM connection
                </Link>
                {canRenameWorkspace ? (
                  <a href="#workspace-details" style={{ ...appFloatingSecondaryButtonStyle, background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#f8fafc', boxShadow: 'none', textAlign: 'center' as const }}>
                    Edit workspace name
                  </a>
                ) : null}
              </div>
            </div>
          </div>

          <section style={{ marginBottom: '1.1rem' }} aria-label="Workspace snapshot">
            <p style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--aisbp-muted)', margin: '0 0 0.5rem' }}>
              QUICK VIEW
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem' }}>
              <div style={statTile}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', letterSpacing: '0.06em' }}>AI REPLIES</span>
                <span style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>{aiShort}</span>
              </div>
              <div style={statTile}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', letterSpacing: '0.06em' }}>ASSISTANT</span>
                <span style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>{assistantTile}</span>
              </div>
              <div style={statTile}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', letterSpacing: '0.06em' }}>REPLY STYLE</span>
                <span style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>{replyStyleTile}</span>
              </div>
              <div style={statTile}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', letterSpacing: '0.06em' }}>CRM</span>
                <span style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>{crmTile}</span>
              </div>
            </div>
          </section>

          <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '1.25rem' }} aria-label="Settings sections">
            <Link href={settingsRoot} style={tabLinkStyle(isGeneral)} aria-current={isGeneral ? 'page' : undefined}>
              General
            </Link>
            <Link href={`${settingsRoot}/advanced`} style={tabLinkStyle(isAdvanced)} aria-current={isAdvanced ? 'page' : undefined}>
              Advanced
            </Link>
          </nav>

          {children}
        </>
      ) : null}
    </div>
  );
}
