'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { listTenantBotProfiles, type TenantBotProfileRow } from '@/lib/api';
import { tenantBasePath } from '@/lib/tenant-workspace-nav';

const tabStyle = (active: boolean): CSSProperties => ({
  padding: '0.5rem 0.85rem',
  borderRadius: '10px',
  border: active ? '1px solid var(--aisbp-border, #e2e8f0)' : '1px solid transparent',
  background: active ? 'var(--aisbp-surface, #fff)' : 'transparent',
  fontWeight: active ? 700 : 600,
  fontSize: '0.84rem',
  color: active ? 'var(--aisbp-text-heading, #0f172a)' : 'var(--aisbp-muted, #64748b)',
  textDecoration: 'none',
  display: 'inline-block',
});

const TABS: { suffix: string; label: string }[] = [
  { suffix: '/automation/tagging', label: 'Tagging' },
  { suffix: '/automation/booking', label: 'Booking' },
  { suffix: '/automation/follow-up', label: 'Follow-up' },
  { suffix: '/automation/escalation', label: 'Human Escalation' },
];

export function AutomationWorkspaceLayout({
  tenantId,
  children,
}: {
  tenantId: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const base = tenantBasePath(tenantId);
  const { token } = useAuth();
  const [profiles, setProfiles] = useState<TenantBotProfileRow[]>([]);

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listTenantBotProfiles(token, tenantId);
        if (!cancelled) setProfiles(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setProfiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId]);

  const activeProfileName = useMemo(() => {
    const active = profiles.find(p => p.isActive);
    return (active?.name ?? '').trim() || null;
  }, [profiles]);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.15rem' }}>
        <p
          style={{
            fontSize: '0.62rem',
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: 'var(--aisbp-muted, #94a3b8)',
            margin: '0 0 0.35rem',
          }}
        >
          Assistant
        </p>
        <h1
          style={{
            fontSize: '1.65rem',
            fontWeight: 800,
            margin: 0,
            color: 'var(--aisbp-text-heading, #0f172a)',
            letterSpacing: '-0.03em',
          }}
        >
          Automation
        </h1>
        <p
          style={{
            fontSize: '0.875rem',
            color: 'var(--aisbp-muted, #64748b)',
            margin: '0.45rem 0 0',
            lineHeight: 1.55,
            maxWidth: '42rem',
          }}
        >
          Automation currently applies across this workspace. All assistant profiles in this workspace use the same tagging,
          booking, follow-up, and handover rules. Profile-specific automation is planned.
        </p>
        <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', margin: '0.5rem 0 0' }}>
          <strong style={{ color: 'var(--aisbp-text-secondary, #334155)' }}>Active assistant:</strong>{' '}
          {activeProfileName ?? '—'}
        </p>
        {/* TODO: When profile-scoped automation is implemented, replace workspace-level copy and wire automation settings through assistant_profile_id with tenant fallback. */}
      </header>

      <nav
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.4rem',
          marginBottom: '1.25rem',
          padding: '0.35rem 0',
          borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
        }}
        aria-label="Automation sections"
      >
        {TABS.map(t => {
          const href = `${base}${t.suffix}`;
          const active = pathname === href || pathname === `${href}/`;
          return (
            <Link key={t.suffix} href={href} style={tabStyle(active)} aria-current={active ? 'page' : undefined}>
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
