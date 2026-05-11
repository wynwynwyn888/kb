'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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
  background: 'var(--aisbp-surface, #fff)',
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  minWidth: '6.5rem',
};

export function TenantSettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const { user } = useAuth();
  const showWorkspaceAdvanced = Boolean(user?.agencyRole);
  const {
    base,
    loading,
    err,
    reload,
    tenantName,
    isAgencyWorkspace,
    botMode,
    promptConfigSnap,
    ghl,
    ghlLoadErr,
    canRenameWorkspace,
  } = useTenantSettings();

  const controlPanelRoot = `${base}/control-panel`;
  const isGeneral = pathname === controlPanelRoot || pathname === `${controlPanelRoot}/`;
  const isAdvanced = pathname.startsWith(`${controlPanelRoot}/advanced`);

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
          Control Panel
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
          Workspace control panel
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
          Manage this workspace&apos;s CRM connection, assistant behavior, and client contact details.
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
              background: 'var(--aisbp-surface-elevated, var(--aisbp-surface, #fff))',
              color: 'var(--aisbp-text, #0f172a)',
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              boxShadow: '0 4px 24px rgba(15, 23, 42, 0.06)',
            }}
            aria-label="Workspace overview"
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 800,
                    letterSpacing: '0.12em',
                    color: 'var(--aisbp-muted, #64748b)',
                  }}
                >
                  {isAgencyWorkspace ? 'AGENCY WORKSPACE' : 'WORKSPACE'}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginTop: '0.25rem',
                  }}
                >
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.2, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    {tenantName ?? 'Workspace'}
                  </div>
                  {isAgencyWorkspace ? <StatusPill label="Agency Workspace" tone="neutral" /> : null}
                </div>
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
                    color: 'var(--aisbp-muted, #64748b)',
                    lineHeight: 1.5,
                    maxWidth: '36rem',
                  }}
                >
                  {isAgencyWorkspace
                    ? 'This workspace supports internal operations, agency-owned CRM activity, and automated low-credit warning delivery.'
                    : heroMetaLine}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', alignItems: 'stretch', minWidth: '12rem' }}>
                <Link href={`${base}/assistant`} style={{ ...appFloatingPrimaryButtonStyle, textAlign: 'center' as const }}>
                  Assistant
                </Link>
                <Link href={`${base}/knowledge-vaults`} style={{ ...appFloatingSecondaryButtonStyle, textAlign: 'center' as const }}>
                  Knowledge vaults
                </Link>
                <Link href={`${base}/ghl-status`} style={{ ...appFloatingSecondaryButtonStyle, textAlign: 'center' as const }}>
                  CRM Connection
                </Link>
                {canRenameWorkspace ? (
                  <a href="#workspace-details" style={{ ...appFloatingSecondaryButtonStyle, textAlign: 'center' as const }}>
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

          <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '1.25rem' }} aria-label="Control panel sections">
            <Link href={controlPanelRoot} style={tabLinkStyle(isGeneral)} aria-current={isGeneral ? 'page' : undefined}>
              General
            </Link>
            {showWorkspaceAdvanced ? (
              <Link
                href={`${controlPanelRoot}/advanced`}
                style={tabLinkStyle(isAdvanced)}
                aria-current={isAdvanced ? 'page' : undefined}
              >
                Advanced
              </Link>
            ) : null}
          </nav>

          {children}
        </>
      ) : null}
    </div>
  );
}
