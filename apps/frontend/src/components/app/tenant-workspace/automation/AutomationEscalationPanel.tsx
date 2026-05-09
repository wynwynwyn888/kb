'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTenantHumanEscalationSettings,
  patchTenantHumanEscalationSettings,
  type TenantHumanEscalationSettings,
} from '@/lib/api';
import {
  ErrorBanner,
  LoadingBlock,
  SectionCard,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpSecondaryButtonStyle,
} from '@/components/app/mvp-ui';

function btn(kind: 'primary' | 'secondary', disabled: boolean): CSSProperties {
  const base = kind === 'primary' ? mvpPrimaryButtonStyle : mvpSecondaryButtonStyle;
  return {
    ...base,
    opacity: disabled ? 0.58 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

export function AutomationEscalationPanel() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();

  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<TenantHumanEscalationSettings | null>(null);
  const [banner, setBanner] = useState('');

  const load = useCallback(async () => {
    if (!token || !tenantId) return;
    setLoading(true);
    try {
      const s = await getTenantHumanEscalationSettings(token, tenantId);
      setSettings(s);
      setLoadErr('');
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load human escalation settings');
    } finally {
      setLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!token || !tenantId || !settings) return;
    setBusy('save-human-escalation');
    setBanner('');
    try {
      const next = await patchTenantHumanEscalationSettings(token, tenantId, settings);
      setSettings(next);
      setBanner('Saved.');
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingBlock message="Loading human escalation…" />;
  if (loadErr) return <ErrorBanner message={loadErr} />;

  const dim = !settings;

  return (
    <>
      <SectionCard
        title="Workspace scope"
        subtitle="Human escalation applies to this workspace. When a customer asks for a person, AISalesBot Pro stops automated replies for that conversation."
        accent="muted"
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: 0 }}>
          These settings apply across the whole workspace.
        </p>
      </SectionCard>

      <SectionCard title="Human escalation" subtitle="Team notification via CRM" accent="default">
        <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: '0 0 1rem' }}>
          Human escalation stops the assistant for that conversation and notifies your team when the customer asks for a
          person or needs manual help.
        </p>

        {settings ? (
          <>
            <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input
                type="checkbox"
                checked={Boolean(settings.enabled)}
                onChange={e => setSettings({ ...settings, enabled: e.target.checked })}
                disabled={dim}
              />
              Enable human escalation
            </label>

            <label style={{ ...mvpLabelStyle, display: 'block' }}>Team notification number</label>
            <input
              value={settings.teamNotificationNumber ?? ''}
              onChange={e =>
                setSettings({
                  ...settings,
                  teamNotificationNumber: e.target.value.trim() ? e.target.value : null,
                })
              }
              placeholder="+6512345678"
              style={{ ...mvpInputStyle, maxWidth: 320, marginBottom: '0.35rem' }}
              disabled={dim}
            />
            <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', margin: '0 0 0.75rem' }}>
              Internal notification is sent through your CRM connection to this number (same pattern as booking alerts).
            </p>

            <label style={{ ...mvpLabelStyle, display: 'block' }}>Optional message prefix</label>
            <textarea
              value={settings.optionalMessagePrefix ?? ''}
              onChange={e =>
                setSettings({
                  ...settings,
                  optionalMessagePrefix: e.target.value.length ? e.target.value : null,
                })
              }
              placeholder="e.g. [Urgent]"
              rows={2}
              style={{ ...mvpInputStyle, width: '100%', maxWidth: 480, marginBottom: '0.75rem', fontSize: '0.8rem' }}
              disabled={dim}
            />

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" style={btn('primary', Boolean(busy))} disabled={Boolean(busy)} onClick={() => void save()}>
                {busy === 'save-human-escalation' ? 'Saving…' : 'Save'}
              </button>
              <button type="button" style={btn('secondary', Boolean(busy))} disabled={Boolean(busy)} onClick={() => void load()}>
                Reload
              </button>
            </div>
            {banner ? (
              <p style={{ fontSize: '0.82rem', margin: '0.65rem 0 0', color: 'var(--aisbp-text-secondary)' }}>{banner}</p>
            ) : null}
          </>
        ) : null}
      </SectionCard>
    </>
  );
}
