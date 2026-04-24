'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getGhlConnection, getTenantById, type GhlConnectionStatus } from '@/lib/api';
import {
  ErrorBanner,
  KeyValueRows,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';

const linkPill: CSSProperties = {
  display: 'inline-block',
  padding: '0.35rem 0.65rem',
  borderRadius: '6px',
  border: '1px solid #e2e8f0',
  background: '#fff',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#1d4ed8',
  textDecoration: 'none',
};

type FootLink = { href: string; label: string };

function ControlSection({ title, subtitle, body, links }: { title: string; subtitle: string; body: string; links: FootLink[] }) {
  return (
    <SectionCard title={title} subtitle={subtitle} accent="muted">
      <p style={{ fontSize: '0.84rem', color: '#475569', lineHeight: 1.55, margin: 0 }}>{body}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.7rem' }}>
        {links.map(f => (
          <Link key={f.href} href={f.href} style={linkPill}>
            {f.label} →
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}

export function TenantSettingsPanel() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantStatus, setTenantStatus] = useState<string | null>(null);
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
            if (!cancelled) setGhlLoadErr(e instanceof Error ? e.message : 'GHL load failed');
            return null;
          }),
        ]);
        if (cancelled) return;
        if (g) setGhl(g);
        setTenantName(tenant?.name ?? null);
        setTenantStatus(tenant?.status ?? null);
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

  return (
    <div>
      <PageHeader title="Settings" eyebrow="Subaccount · Bot" />
      <p style={{ fontSize: '0.86rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: '40rem' }}>
        Operations, posture, and support identifiers.
      </p>

      {err && (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorBanner message={err} />
          <button
            type="button"
            onClick={() => {
              setErr('');
              setLoadAttempt(a => a + 1);
            }}
            style={{
              marginTop: '0.5rem',
              ...mvpPrimaryButtonStyle,
              background: '#fff',
              color: '#111',
              border: '1px solid #ccc',
            }}
          >
            Try again
          </button>
        </div>
      )}

      {loading && !err ? <LoadingBlock message="Loading control center…" /> : null}

      {!loading && !err ? (
        <>
          <div
            style={{
              borderRadius: '10px',
              marginBottom: '1.1rem',
              padding: '1.05rem 1.1rem 1.1rem',
              background: 'linear-gradient(125deg, #0f172a 0%, #1e293b 100%)',
              color: '#f1f5f9',
              boxShadow: '0 6px 20px rgba(15, 23, 42, 0.25)',
            }}
            aria-label="Subaccount at a glance"
          >
            <div style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(148, 163, 184, 0.95)' }}>
              CURRENT
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, margin: '0.2rem 0' }}>{tenantName ?? 'Subaccount'}</div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '0.4rem 0.65rem',
                marginTop: '0.5rem',
              }}
            >
              {tenantStatus ? <StatusPill label={tenantStatus} tone="neutral" /> : null}
              {ghl && !ghlLoadErr ? (
                <StatusPill
                  label={`GHL ${ghl.status}`}
                  tone={ghl.status === 'CONNECTED' ? 'ok' : ghl.status === 'DISCONNECTED' ? 'neutral' : 'warn'}
                />
              ) : null}
              {promptConfigSnap ? (
                <span style={{ fontSize: '0.78rem', color: 'rgba(203, 213, 225, 0.95)' }}>
                  Profile: <strong style={{ color: '#fff' }}>{promptConfigSnap.name}</strong>
                </span>
              ) : null}
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.4rem 0.55rem',
                marginTop: '0.85rem',
                fontSize: '0.78rem',
                fontWeight: 700,
              }}
            >
              <Link
                href={`${base}/goals`}
                style={{ color: '#7dd3fc', textDecoration: 'none' }}
              >
                Goals
              </Link>
              <span style={{ color: 'rgba(148, 163, 184, 0.4)' }}>·</span>
              <Link
                href={`${base}/knowledge`}
                style={{ color: '#7dd3fc', textDecoration: 'none' }}
              >
                Knowledge
              </Link>
              <span style={{ color: 'rgba(148, 163, 184, 0.4)' }}>·</span>
              <Link
                href={`${base}/ghl-status`}
                style={{ color: '#7dd3fc', textDecoration: 'none' }}
              >
                GHL
              </Link>
              <span style={{ color: 'rgba(148, 163, 184, 0.4)' }}>·</span>
              <Link
                href={`${base}/conversations`}
                style={{ color: '#7dd3fc', textDecoration: 'none' }}
              >
                Activity
              </Link>
            </div>
          </div>

          <SectionCard
            title="GHL"
            subtitle="Read-only. Edit under Advanced."
            accent="muted"
          >
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
                            ghl.status === 'CONNECTED'
                              ? 'ok'
                              : ghl.status === 'DISCONNECTED'
                                ? 'neutral'
                                : 'warn'
                          }
                        />
                      ),
                    },
                    { label: 'Location id', value: ghl.ghlLocationId?.trim() || '—' },
                    { label: 'Verified', value: ghl.verifiedAt ? ghl.verifiedAt : '—' },
                  ]}
                />
                <p style={{ margin: '0.75rem 0 0' }}>
                  <Link href={`${base}/ghl-status`} style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'none' }}>
                    GHL connection →
                  </Link>
                </p>
              </div>
            ) : (
              <p style={{ fontSize: '0.84rem', color: '#64748b', margin: 0 }}>No GHL payload returned.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Bot mode & status"
            subtitle="Live readout. Prompts in Goals."
            accent="default"
          >
            <KeyValueRows
              rows={[
                { label: 'Subaccount', value: tenantName ?? '—' },
                {
                  label: 'Status',
                  value: tenantStatus ? <StatusPill label={tenantStatus} tone="neutral" /> : '—',
                },
                {
                  label: 'Mode / profile',
                  value: promptConfigSnap
                    ? `${promptConfigSnap.name}${promptConfigSnap.isActive ? ' (active)' : ''}`
                    : '— (no synced config)',
                },
                {
                  label: 'Temperature (synced)',
                  value: promptConfigSnap != null ? String(promptConfigSnap.temperature) : '—',
                },
                {
                  label: 'Model override',
                  value: promptConfigSnap?.modelOverride?.trim() || '—',
                },
              ]}
            />
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0.75rem 0 0', lineHeight: 1.45 }}>
              <Link href={`${base}/goals`} style={{ color: '#1d4ed8', fontWeight: 600 }}>
                Goals
              </Link>{' '}
              for prompts. API-only fields will show here when available.
            </p>
          </SectionCard>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <ControlSection
              title="Human handover"
              subtitle="Queue & routing"
              body="Handover queue is not available in this app yet. Monitor in Activity and Diagnostics; tune escalation copy in Goals."
              links={[
                { href: `${base}/conversations`, label: 'Activity' },
                { href: `${base}/diagnostics`, label: 'Diagnostics' },
                { href: `${base}/goals`, label: 'Goals' },
              ]}
            />
            <ControlSection
              title="Booking"
              subtitle="Calendars & availability"
              body="No booking write API. Source of truth for slots remains in GHL for now."
              links={[{ href: `${base}/ghl-status`, label: 'GHL' }]}
            />
            <ControlSection
              title="Tagging"
              subtitle="Segments & labels"
              body="Tag CRUD is not in this app yet. Knowledge and Activity for what exists today."
              links={[
                { href: `${base}/knowledge`, label: 'Knowledge Base' },
                { href: `${base}/conversations`, label: 'Activity' },
              ]}
            />
            <ControlSection
              title="Channels & behavior"
              subtitle="Where the bot runs"
              body="Per-channel policy editing is not in this app yet. Routing is server-side. Shape tone in Goals; verify GHL and runtime in Diagnostics."
              links={[
                { href: `${base}/goals`, label: 'Goals' },
                { href: `${base}/ghl-status`, label: 'GHL' },
                { href: `${base}/diagnostics`, label: 'Diagnostics' },
              ]}
            />
          </div>

          <SectionCard title="Identifiers" subtitle="Support.">
            <KeyValueRows rows={[{ label: 'Name', value: tenantName ?? '—' }]} />
            <details style={{ marginTop: '0.65rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: '#64748b' }}>Technical details</summary>
              <div style={{ marginTop: '0.5rem' }}>
                <KeyValueRows rows={[{ label: 'Subaccount id', value: tenantId, mono: true }]} />
              </div>
            </details>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
