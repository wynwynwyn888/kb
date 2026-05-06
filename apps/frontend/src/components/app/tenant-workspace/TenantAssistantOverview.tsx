'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { listTenantBotProfiles, type TenantBotProfileRow } from '@/lib/api';
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
  appFloatingPrimaryButtonStyle,
  appFloatingSecondaryButtonStyle,
} from '@/components/app/mvp-ui';

export function TenantAssistantOverview() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [profiles, setProfiles] = useState<TenantBotProfileRow[]>([]);

  const base = `/app/tenant/${tenantId}`;

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

  const active = profiles.find(p => p.isActive) ?? null;

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
        Persona, goals, vault access, automation, and testing are scoped to the selected assistant profile.
      </p>

      {err ? (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorBanner message={err} />
        </div>
      ) : null}
      {loading ? <LoadingBlock message="Loading assistant…" /> : null}

      {!loading && !err ? (
        <>
          <SectionCard title="Active profile" subtitle="Used for live customer replies.">
            {active ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    {active.name.trim() || 'Untitled assistant'}
                  </span>
                  <StatusPill label="Live" tone="ok" />
                </div>
                {active.description?.trim() ? (
                  <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.5rem' }}>
                    {active.description.trim()}
                  </p>
                ) : null}
                <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.35rem' }}>
                  Vaults:{' '}
                  <strong style={{ fontWeight: 600, color: 'var(--aisbp-text-secondary, #334155)' }}>
                    {activeAssistantVaultsSummary(active.knowledgeAccessMode, active.selectedVaultIds?.length ?? 0)}
                  </strong>
                </p>
                <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0 0 1rem' }}>
                  Last updated {formatProfileUpdatedAt(active.updatedAt)}
                </p>
              </>
            ) : (
              <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
                No active assistant profile yet. Create or activate one under Profiles.
              </p>
            )}
          </SectionCard>

          <SectionCard title="Quick actions" subtitle="Jump into the most common assistant tasks." accent="muted">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              <Link href={`${base}/assistant/instructions`} style={appFloatingPrimaryButtonStyle}>
                Edit instructions
              </Link>
              <Link href={`${base}/assistant/automation/tags`} style={appFloatingSecondaryButtonStyle}>
                Manage automation
              </Link>
              <Link href={`${base}/assistant/test-bot`} style={appFloatingSecondaryButtonStyle}>
                Test bot
              </Link>
              <Link href={`${base}/assistant/profiles`} style={appFloatingSecondaryButtonStyle}>
                Profiles
              </Link>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '0.85rem 0 0', lineHeight: 1.45 }}>
              Duplicate or create profiles from <Link href={`${base}/assistant/profiles`}>Profiles</Link> while editing a
              profile.
            </p>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
