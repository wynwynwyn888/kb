'use client';

import { useParams } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTenantBookingSettings,
  getTenantFollowUpSettings,
  getTenantTaggingSettings,
  listTenantBotProfiles,
  type TenantBookingSettings,
  type TenantBotProfileRow,
  type TenantFollowUpSettings,
  type TenantTaggingSettings,
} from '@/lib/api';
import {
  activeAssistantVaultsSummary,
  formatProfileUpdatedAt,
} from '@/lib/assistant-profiles-ui';
import {
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
} from '@/components/app/mvp-ui';

const gridWrap: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
  gap: '0.75rem',
};

const statCard: CSSProperties = {
  border: '1px solid var(--aisbp-border)',
  borderRadius: 12,
  padding: '0.85rem 0.9rem',
  background: 'var(--aisbp-surface)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  minHeight: 78,
};

const statLabel: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--aisbp-muted, #94a3b8)',
  margin: 0,
};

export function TenantAssistantOverview() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [profiles, setProfiles] = useState<TenantBotProfileRow[]>([]);
  const [tagging, setTagging] = useState<TenantTaggingSettings | null>(null);
  const [booking, setBooking] = useState<TenantBookingSettings | null>(null);
  const [followUp, setFollowUp] = useState<TenantFollowUpSettings | null>(null);

  const load = useCallback(async () => {
    if (!token || !tenantId) return;
    setLoading(true);
    setErr('');
    try {
      const list = await listTenantBotProfiles(token, tenantId);
      setProfiles(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load assistant profiles');
    } finally {
      setLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => profiles.find(p => p.isActive) ?? null, [profiles]);

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;

    const loadAutomation = async () => {
      try {
        const [t, b, f] = await Promise.all([
          getTenantTaggingSettings(token, tenantId),
          getTenantBookingSettings(token, tenantId),
          getTenantFollowUpSettings(token, tenantId),
        ]);
        if (cancelled) return;
        setTagging(t);
        setBooking(b);
        setFollowUp(f);
      } catch {
        // Non-blocking; dashboard can still show profile info.
      }
    };

    void loadAutomation();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId]);

  const activeProfileStatus = active
    ? { label: 'Active', tone: 'ok' as const }
    : { label: 'Draft', tone: 'neutral' as const };

  const vaultCount = active?.selectedVaultIds?.length ?? 0;
  const vaultSummary = active ? activeAssistantVaultsSummary(active.knowledgeAccessMode, vaultCount) : '—';
  const vaultStatus =
    active && active.knowledgeAccessMode === 'selected_vaults' && vaultCount === 0
      ? { label: 'No vaults selected', tone: 'warn' as const }
      : active
        ? { label: 'Configured', tone: 'ok' as const }
        : { label: '—', tone: 'neutral' as const };

  const taggingStatus = tagging
    ? tagging.automaticTaggingEnabled
      ? { label: 'Enabled', tone: 'ok' as const }
      : { label: 'Disabled', tone: 'neutral' as const }
    : { label: '—', tone: 'neutral' as const };

  const bookingStatus = booking
    ? booking.enabled
      ? { label: 'Enabled', tone: 'ok' as const }
      : { label: 'Disabled', tone: 'neutral' as const }
    : { label: '—', tone: 'neutral' as const };

  const followUpStatus = followUp
    ? followUp.enabled
      ? { label: 'Enabled', tone: 'ok' as const }
      : { label: 'Disabled', tone: 'neutral' as const }
    : { label: '—', tone: 'neutral' as const };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHeader title="Assistant" eyebrow="Overview" />
      <p
        style={{
          fontSize: '0.875rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '-0.65rem 0 1.15rem',
          maxWidth: '42rem',
          lineHeight: 1.55,
        }}
      >
        This assistant uses its own instructions and selected knowledge vaults. Automation rules currently apply at workspace
        level. CRM tags, calendars, and contact data are synced from the workspace connection.
      </p>

      {err ? (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorBanner message={err} />
        </div>
      ) : null}
      {loading ? <LoadingBlock message="Loading assistant…" /> : null}

      {!loading && !err ? (
        <>
          <SectionCard title="Active profile" subtitle="Status for the currently active assistant profile.">
            {active ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    {active.name.trim() || 'Untitled assistant'}
                  </span>
                  <StatusPill label={activeProfileStatus.label} tone={activeProfileStatus.tone} />
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.65rem' }}>
                  <strong style={{ color: 'var(--aisbp-text-secondary, #334155)' }}>Active profile</strong> — instructions and vault selection are profile-scoped.
                </p>
                {active.description?.trim() ? (
                  <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.5rem' }}>
                    {active.description.trim()}
                  </p>
                ) : null}
                <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0 0 1rem' }}>
                  Last updated {formatProfileUpdatedAt(active.updatedAt)}
                </p>

                <div style={gridWrap} aria-label="Assistant status">
                  <div style={{ ...statCard, gridColumn: 'span 3' }}>
                    <p style={statLabel}>Selected knowledge vaults</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                      <StatusPill label={vaultStatus.label} tone={vaultStatus.tone} />
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-text-secondary)', margin: 0 }}>{vaultSummary}</p>
                  </div>

                  <div style={{ ...statCard, gridColumn: 'span 3' }}>
                    <p style={statLabel}>Workspace tagging</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                      <StatusPill label={taggingStatus.label} tone={taggingStatus.tone} />
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted)', margin: 0 }}>Applies across this workspace</p>
                  </div>

                  <div style={{ ...statCard, gridColumn: 'span 3' }}>
                    <p style={statLabel}>Workspace booking</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                      <StatusPill label={bookingStatus.label} tone={bookingStatus.tone} />
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted)', margin: 0 }}>
                      Calendar: {booking?.defaultGhlCalendarName ?? '—'}
                    </p>
                  </div>

                  <div style={{ ...statCard, gridColumn: 'span 3' }}>
                    <p style={statLabel}>Workspace follow-up</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                      <StatusPill label={followUpStatus.label} tone={followUpStatus.tone} />
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted)', margin: 0 }}>
                      Steps: {followUp?.steps?.filter(s => s.enabled).length ?? '—'}
                    </p>
                  </div>

                  <div style={{ ...statCard, gridColumn: 'span 6' }}>
                    <p style={statLabel}>Workspace human handover</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                      <StatusPill label="Status only" tone="neutral" />
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted)', margin: 0 }}>
                      Triggers and routing policies are being expanded in a later milestone.
                    </p>
                  </div>

                  <div style={{ ...statCard, gridColumn: 'span 6' }}>
                    <p style={statLabel}>Knowledge vault status</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                      <StatusPill label={vaultStatus.label} tone={vaultStatus.tone} />
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted)', margin: 0 }}>
                      Vault access is selected per profile; full vault management lives in Knowledge Vaults.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
                No active assistant profile yet. Create or activate one under Profiles.
              </p>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
