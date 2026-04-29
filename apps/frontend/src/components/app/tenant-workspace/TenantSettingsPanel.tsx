'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getGhlConnection, getTenantById, updateWorkspaceSettings, type GhlConnectionStatus, type WorkspaceBotMode } from '@/lib/api';
import { emitTenantWorkspaceMetaChanged } from '@/lib/workspace-events';
import {
  ErrorBanner,
  KeyValueRows,
  LoadingBlock,
  SectionCard,
  StatusPill,
  SuccessBanner,
  appFloatingPrimaryButtonStyle,
  appFloatingSecondaryButtonStyle,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';
import { WorkspaceBotModeSection } from './WorkspaceBotModeSection';

type FootLink = { href: string; label: string };

function ControlSection({ title, subtitle, body, links }: { title: string; subtitle: string; body: string; links: FootLink[] }) {
  return (
    <SectionCard title={title} subtitle={subtitle} accent="muted">
      <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text-secondary, #475569)', lineHeight: 1.55, margin: 0 }}>{body}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
        {links.map(f => (
          <Link key={f.href} href={f.href} style={appFloatingSecondaryButtonStyle}>
            {f.label}
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}

const statTile: CSSProperties = {
  padding: '0.55rem 0.75rem',
  borderRadius: 12,
  background: 'var(--aisbp-stat-tile-bg, #f8fafc)',
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  minWidth: '6.5rem',
};

export function TenantSettingsPanel() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantAgencyId, setTenantAgencyId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [tenantStatus, setTenantStatus] = useState<string | null>(null);
  const [botMode, setBotMode] = useState<WorkspaceBotMode>('autopilot');
  const [promptConfigSnap, setPromptConfigSnap] = useState<
    | {
        name: string;
        temperature: number;
        modelOverride?: string;
        isActive?: boolean;
      }
    | null
  >(null);
  const [err, setErr] = useState('');
  const [ghl, setGhl] = useState<GhlConnectionStatus | null>(null);
  const [ghlLoadErr, setGhlLoadErr] = useState('');

  const base = `/app/tenant/${tenantId}`;

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      setGhlLoadErr('');
      try {
        const [tenant, g] = await Promise.all([
          getTenantById(token, tenantId),
          getGhlConnection(token, tenantId).catch(e => {
            if (!cancelled) setGhlLoadErr(e instanceof Error ? e.message : 'CRM connection could not be loaded');
            return null;
          }),
        ]);
        if (cancelled) return;
        if (g) setGhl(g);
        setTenantName(tenant?.name ?? null);
        setNameDraft((tenant?.name ?? '').trim() ? (tenant?.name ?? '') : '');
        setTenantAgencyId(tenant?.agencyId ?? null);
        setTenantStatus(tenant?.status ?? null);
        if (tenant?.botMode) setBotMode(tenant.botMode);
        const pc = tenant?.promptConfig;
        setPromptConfigSnap(
          pc
            ? {
                name: pc.name,
                temperature: pc.temperature,
                modelOverride: pc.modelOverride,
                isActive: pc.isActive,
              }
            : null,
        );
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId, loadAttempt]);

  const canRenameWorkspace = Boolean(user?.agencyId && tenantAgencyId && user.agencyId === tenantAgencyId);

  const aiModeLabel = botMode === 'off' ? 'Off' : botMode === 'suggestive' ? 'Suggestive' : 'Auto';

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.35rem' }}>
        <p
          style={{
            fontSize: '0.62rem',
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: 'var(--aisbp-muted, #94a3b8)',
            margin: '0 0 0.35rem',
          }}
        >
          Workspace overview
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
          Review setup, connection status, and routing options for this workspace.
        </p>
      </header>

      {err && (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorBanner message={err} />
          <button
            type="button"
            onClick={() => {
              setErr('');
              setLoadAttempt(a => a + 1);
            }}
            style={{ marginTop: '0.5rem', ...appFloatingSecondaryButtonStyle }}
          >
            Try again
          </button>
        </div>
      )}

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
            aria-label="Workspace status"
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(148, 163, 184, 0.95)' }}>
                  WORKSPACE STATUS
                </div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, margin: '0.25rem 0 0', lineHeight: 1.2 }}>{tenantName ?? 'Workspace'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem', marginTop: '0.65rem' }}>
                  {ghl && !ghlLoadErr && ghl.status === 'CONNECTED' ? (
                    <StatusPill label="CRM connected" tone="ok" />
                  ) : (
                    <>
                      {tenantStatus ? <StatusPill label={tenantStatus} tone="neutral" /> : null}
                      {ghl && !ghlLoadErr ? (
                        <StatusPill
                          label={`CRM ${ghl.status === 'DISCONNECTED' ? 'needs setup' : 'needs review'}`}
                          tone={ghl.status === 'DISCONNECTED' ? 'neutral' : 'warn'}
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', alignItems: 'stretch' }}>
                {canRenameWorkspace ? (
                  <a href="#workspace-rename" style={{ ...appFloatingPrimaryButtonStyle, textAlign: 'center' as const }}>
                    Edit workspace name
                  </a>
                ) : null}
                <Link href={`${base}/goals`} style={{ ...appFloatingSecondaryButtonStyle, background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#f8fafc', boxShadow: 'none' }}>
                  Open bot instructions
                </Link>
                <Link href={`${base}/ghl-status`} style={{ ...appFloatingSecondaryButtonStyle, background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#f8fafc', boxShadow: 'none' }}>
                  CRM connection
                </Link>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.1rem', alignItems: 'stretch', marginBottom: '1.1rem' }}>
            <div style={{ flex: '2 1 340px', minWidth: 0 }}>
              {token && tenantId ? (
                <WorkspaceBotModeSection
                  mode={botMode}
                  disabled={!token}
                  onChange={async m => {
                    await updateWorkspaceSettings(token, tenantId, { botMode: m });
                    setBotMode(m);
                    setLoadAttempt(a => a + 1);
                  }}
                />
              ) : null}
            </div>
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <SectionCard title="CRM connection" subtitle="Connection status and saved location for this workspace’s CRM." accent="muted">
                {ghlLoadErr ? (
                  <p style={{ fontSize: '0.84rem', color: '#b91c1c', margin: 0 }}>{ghlLoadErr}</p>
                ) : ghl ? (
                  <div>
                    <KeyValueRows
                      rows={[
                        {
                          label: 'Status',
                          value: (
                            <StatusPill
                              label={ghl.status}
                              tone={
                                ghl.status === 'CONNECTED' ? 'ok' : ghl.status === 'DISCONNECTED' ? 'neutral' : 'warn'
                              }
                            />
                          ),
                        },
                        { label: 'Location', value: ghl.ghlLocationId?.trim() ? 'Saved' : 'Not saved' },
                        { label: 'Verified', value: ghl.verifiedAt ? ghl.verifiedAt : '—' },
                      ]}
                    />
                    <div style={{ marginTop: '0.85rem' }}>
                      <Link href={`${base}/ghl-status`} style={appFloatingSecondaryButtonStyle}>
                        Manage CRM
                      </Link>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>CRM is not connected yet.</p>
                )}
              </SectionCard>
            </div>
          </div>

          {canRenameWorkspace && token && tenantId ? (
            <div id="workspace-rename" style={{ scrollMarginTop: '1rem' }}>
              <SectionCard title="Workspace name" subtitle="Renaming is limited to agency staff so client-facing lists stay tidy." accent="muted">
                {nameMsg ? <SuccessBanner message={nameMsg} /> : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '420px' }}>
                  <label style={mvpLabelStyle}>
                    Display name
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={e => {
                        setNameDraft(e.target.value);
                        setNameMsg('');
                      }}
                      disabled={nameSaving}
                      autoComplete="off"
                      style={mvpInputStyle}
                      aria-label="Workspace display name"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={nameSaving || !nameDraft.trim() || nameDraft.trim() === (tenantName ?? '').trim()}
                    style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: nameSaving ? 0.85 : 1 }}
                    onClick={async () => {
                      if (!token || !nameDraft.trim()) return;
                      setNameSaving(true);
                      setNameMsg('');
                      setErr('');
                      try {
                        const updated = await updateWorkspaceSettings(token, tenantId, {
                          name: nameDraft.trim(),
                        });
                        setTenantName(updated.name);
                        setNameDraft(updated.name);
                        setNameMsg('Workspace name saved.');
                        emitTenantWorkspaceMetaChanged(tenantId);
                        setLoadAttempt(a => a + 1);
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : 'Could not save name');
                      } finally {
                        setNameSaving(false);
                      }
                    }}
                  >
                    {nameSaving ? 'Saving…' : 'Save name'}
                  </button>
                </div>
              </SectionCard>
            </div>
          ) : null}

          <SectionCard title="Bot status" subtitle="Current bot instructions and reply settings for this workspace." accent="default">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', marginBottom: '1rem' }}>
              <div style={statTile}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', letterSpacing: '0.06em' }}>AI MODE</span>
                <span style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>{aiModeLabel}</span>
              </div>
              <div style={statTile}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', letterSpacing: '0.06em' }}>INSTRUCTIONS</span>
                <span style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                  {promptConfigSnap ? (promptConfigSnap.isActive ? 'Active' : 'Inactive') : '—'}
                </span>
              </div>
              <div style={statTile}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', letterSpacing: '0.06em' }}>REPLY STYLE</span>
                <span style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                  {promptConfigSnap != null ? String(promptConfigSnap.temperature) : '—'}
                </span>
              </div>
              <div style={statTile}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--aisbp-muted, #94a3b8)', letterSpacing: '0.06em' }}>MODEL</span>
                <span style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                  {promptConfigSnap?.modelOverride?.trim() || '—'}
                </span>
              </div>
            </div>
            <KeyValueRows
              rows={[
                { label: 'Workspace', value: tenantName ?? '—' },
                {
                  label: 'Account',
                  value: tenantStatus ? <StatusPill label={tenantStatus} tone="neutral" /> : '—',
                },
                {
                  label: 'AI mode',
                  value: (
                    <StatusPill
                      label={aiModeLabel}
                      tone={botMode === 'off' ? 'neutral' : 'ok'}
                    />
                  ),
                },
                {
                  label: 'Bot instructions',
                  value: promptConfigSnap
                    ? `${promptConfigSnap.name}${promptConfigSnap.isActive ? ' (active)' : ''}`
                    : 'Not configured yet',
                },
                {
                  label: 'Reply style',
                  value: promptConfigSnap != null ? String(promptConfigSnap.temperature) : '—',
                },
                {
                  label: 'Model override',
                  value: promptConfigSnap?.modelOverride?.trim() || '—',
                },
              ]}
            />
            <div style={{ marginTop: '0.85rem' }}>
              <Link href={`${base}/goals`} style={appFloatingSecondaryButtonStyle}>
                Open bot instructions
              </Link>
            </div>
          </SectionCard>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '0.85rem',
              marginBottom: '1rem',
            }}
          >
            <ControlSection
              title="Human handoff"
              subtitle="Escalation and routing"
              body="Coming soon in AISBP. For now, review conversations in Activity and adjust handoff wording in Bot Instructions."
              links={[
                { href: `${base}/conversations`, label: 'Open activity' },
                { href: `${base}/diagnostics`, label: 'Open diagnostics' },
                { href: `${base}/goals`, label: 'Open bot instructions' },
              ]}
            />
            <ControlSection
              title="Booking"
              subtitle="Calendars & availability"
              body="Managed in your CRM for now. Connect it before using booking-related workflows."
              links={[{ href: `${base}/ghl-status`, label: 'Open CRM' }]}
            />
            <ControlSection
              title="Tags"
              subtitle="Segments & labels"
              body="Managed in your CRM for now. Knowledge and Activity show what AISBP can use today."
              links={[
                { href: `${base}/knowledge`, label: 'Open knowledge' },
                { href: `${base}/conversations`, label: 'Open activity' },
              ]}
            />
            <ControlSection
              title="Channels & behavior"
              subtitle="Where the bot runs"
              body="Coming soon. Use Bot Instructions for tone and Diagnostics for support checks."
              links={[
                { href: `${base}/goals`, label: 'Open bot instructions' },
                { href: `${base}/ghl-status`, label: 'Open CRM' },
                { href: `${base}/diagnostics`, label: 'Open diagnostics' },
              ]}
            />
          </div>

          <SectionCard title="Advanced identifiers" subtitle="For support and troubleshooting.">
            <KeyValueRows rows={[{ label: 'Name', value: tenantName ?? '—' }]} />
            <details style={{ marginTop: '0.65rem' }}>
              <summary
                style={{
                  cursor: 'pointer',
                  listStyle: 'none',
                  ...appFloatingSecondaryButtonStyle,
                  display: 'inline-flex',
                  width: 'fit-content',
                }}
              >
                Support details
              </summary>
              <div style={{ marginTop: '0.65rem' }}>
                <KeyValueRows rows={[{ label: 'Workspace ID', value: tenantId, mono: true }]} />
              </div>
            </details>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
