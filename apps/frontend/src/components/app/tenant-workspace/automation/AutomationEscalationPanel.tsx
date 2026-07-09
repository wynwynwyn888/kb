'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getActiveHandovers,
  getTenantHumanEscalationSettings,
  patchTenantHumanEscalationSettings,
  resumeHandover,
  type ActiveHandoverRow,
  type TenantHumanEscalationSettings,
} from '@/lib/api';
import {
  ErrorBanner,
  LoadingBlock,
  SectionCard,
  StatusPill,
  formatDateTime,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpSecondaryButtonStyle,
} from '@/components/app/mvp-ui';
import { useToast } from '@/components/app/ToastProvider';

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
  const { pushToast } = useToast();

  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<TenantHumanEscalationSettings | null>(null);
  const [banner, setBanner] = useState('');
  const [activeHandovers, setActiveHandovers] = useState<ActiveHandoverRow[]>([]);
  const [handoversLoading, setHandoversLoading] = useState(false);
  const [resumeActiveOnDisable, setResumeActiveOnDisable] = useState(true);

  const loadHandovers = useCallback(async () => {
    if (!token || !tenantId) return;
    setHandoversLoading(true);
    try {
      const rows = await getActiveHandovers(token, tenantId);
      setActiveHandovers(rows);
    } catch {
      setActiveHandovers([]);
    } finally {
      setHandoversLoading(false);
    }
  }, [token, tenantId]);

  const load = useCallback(async () => {
    if (!token || !tenantId) return;
    setLoading(true);
    try {
      const s = await getTenantHumanEscalationSettings(token, tenantId);
      setSettings(s);
      setLoadErr('');
      await loadHandovers();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load human escalation settings');
    } finally {
      setLoading(false);
    }
  }, [token, tenantId, loadHandovers]);

  useEffect(() => {
    void load();
  }, [load]);

  const resumeOne = async (conversationId: string) => {
    if (!token) return;
    setBusy(`resume-${conversationId}`);
    setBanner('');
    try {
      await resumeHandover(token, conversationId);
      setActiveHandovers(prev => prev.filter(h => h.conversationId !== conversationId));
      const message = 'AI resumed for this conversation.';
      setBanner(message);
      pushToast(message, 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not resume AI Agent';
      setBanner(message);
      pushToast(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const resumeAllActive = async () => {
    if (!token || activeHandovers.length === 0) return;
    const count = activeHandovers.length;
    setBusy('resume-all');
    setBanner('');
    try {
      for (const h of activeHandovers) {
        await resumeHandover(token, h.conversationId);
      }
      setActiveHandovers([]);
      const message = `AI resumed for ${count} conversation(s).`;
      setBanner(message);
      pushToast(message, 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not resume all conversations';
      setBanner(message);
      pushToast(message, 'error');
      await loadHandovers();
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!token || !tenantId || !settings) return;
    setBusy('save-human-escalation');
    setBanner('');
    const countBeforeResume = activeHandovers.length;
    try {
      const disabling = !settings.enabled;
      if (disabling && resumeActiveOnDisable && countBeforeResume > 0) {
        for (const h of activeHandovers) {
          await resumeHandover(token, h.conversationId);
        }
        setActiveHandovers([]);
      }
      const next = await patchTenantHumanEscalationSettings(token, tenantId, settings);
      setSettings(next);
      if (disabling && resumeActiveOnDisable && countBeforeResume > 0) {
        setBanner('Human escalation disabled and active escalations ended.');
      } else if (disabling) {
        setBanner(
          'Human escalation disabled. Conversations already in escalation stay paused until you resume them below.',
        );
      } else {
        setBanner('Saved.');
      }
      await loadHandovers();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingBlock message="Loading human escalation…" />;
  if (loadErr) return <ErrorBanner message={loadErr} />;

  const dim = !settings;
  const hasActive = activeHandovers.length > 0;
  const bannerIsError = Boolean(banner) && /fail|could not|required|error/i.test(banner);

  return (
    <>
      <SectionCard
        title="Workspace scope"
        subtitle="Human escalation applies to this workspace. When a customer asks for a person—or the AI Agent replies with a team follow-up promise—AISalesBot Pro stops automated replies for that conversation."
        accent="muted"
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: 0 }}>
          Uncheck <strong>Enable human escalation</strong> to stop new escalations. Use <strong>Resume AI Agent</strong>{' '}
          below to cancel an escalation that is already active.
        </p>
      </SectionCard>

      {banner ? (
        <div
          role={bannerIsError ? 'alert' : 'status'}
          style={{
            padding: '0.75rem 0.9rem',
            borderRadius: 8,
            border: bannerIsError
              ? '1px solid var(--aisbp-alert-error-border, #f5c2c7)'
              : '1px solid var(--aisbp-alert-success-border, #b7e0c8)',
            background: bannerIsError
              ? 'var(--aisbp-alert-error-bg, #fde8e8)'
              : 'var(--aisbp-alert-success-bg, #e6f7ed)',
            color: bannerIsError
              ? 'var(--aisbp-alert-error-fg, #8b1d1d)'
              : 'var(--aisbp-alert-success-fg, #0d5c2e)',
            fontSize: '0.86rem',
            fontWeight: 600,
          }}
        >
          {banner}
        </div>
      ) : null}

      <SectionCard title="Human escalation" subtitle="Team notification via CRM" accent="default">
        <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: '0 0 1rem' }}>
          Human escalation stops the AI Agent for that conversation and notifies your team when the customer asks for a
          person, or when the AI Agent’s reply promises that someone from the team will follow up.
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

            {!settings.enabled && hasActive ? (
              <label
                style={{
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  marginBottom: '0.75rem',
                  color: 'var(--aisbp-text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={resumeActiveOnDisable}
                  onChange={e => setResumeActiveOnDisable(e.target.checked)}
                  disabled={Boolean(busy)}
                  style={{ marginTop: '0.2rem' }}
                />
                <span>
                  When saving disabled settings, also resume the AI Agent for all {activeHandovers.length}{' '}
                  conversation(s) currently in escalation
                </span>
              </label>
            ) : null}

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
              disabled={dim || !settings.enabled}
            />
            <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', margin: '0 0 0.75rem' }}>
              Required when escalation is enabled. Internal notification is sent through your CRM connection to this
              number (same pattern as booking alerts).
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
              disabled={dim || !settings.enabled}
            />

            <SaveButtonRow busy={busy} onSave={() => void save()} onReload={() => void load()} />
          </>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Cancel active escalation"
        subtitle="End human handover and let the AI Agent reply again"
        accent={hasActive ? 'warn' : 'muted'}
      >
        {handoversLoading ? <LoadingBlock message="Loading active escalations…" /> : null}
        {!handoversLoading && !hasActive ? (
          <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-text-secondary)', margin: 0 }}>
            No conversations are waiting for a human. The AI Agent is replying normally.
          </p>
        ) : null}
        {!handoversLoading && hasActive ? (
          <>
            <p style={{ fontSize: '0.88rem', color: 'var(--aisbp-text-secondary)', margin: '0 0 0.75rem' }}>
              These conversations are paused for the AI Agent. Resume when your team is done.
            </p>
            <button
              type="button"
              style={{ ...btn('secondary', Boolean(busy)), marginBottom: '0.85rem' }}
              disabled={Boolean(busy)}
              onClick={() => void resumeAllActive()}
            >
              {busy === 'resume-all' ? 'Resuming…' : `Resume AI Agent for all (${activeHandovers.length})`}
            </button>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {activeHandovers.map(h => (
                <li
                  key={h.handoverId}
                  style={{
                    border: '1px solid var(--aisbp-border)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    background: 'var(--aisbp-card-subtle)',
                  }}
                >
                  <HandoverRow handover={h} busy={busy} onResume={() => void resumeOne(h.conversationId)} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </SectionCard>
    </>
  );
}

function SaveButtonRow({
  busy,
  onSave,
  onReload,
}: {
  busy: string | null;
  onSave: () => void;
  onReload: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" style={btn('primary', Boolean(busy))} disabled={Boolean(busy)} onClick={onSave}>
        {busy === 'save-human-escalation' ? 'Saving…' : 'Save'}
      </button>
      <button type="button" style={btn('secondary', Boolean(busy))} disabled={Boolean(busy)} onClick={onReload}>
        Reload
      </button>
    </div>
  );
}

function HandoverRow({
  handover,
  busy,
  onResume,
}: {
  handover: ActiveHandoverRow;
  busy: string | null;
  onResume: () => void;
}) {
  const resuming = busy === `resume-${handover.conversationId}`;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center', justifyContent: 'space-between' }}>
      <HandoverMeta handover={handover} />
      <button type="button" style={btn('primary', Boolean(busy))} disabled={Boolean(busy)} onClick={onResume}>
        {resuming ? 'Resuming…' : 'Resume AI Agent'}
      </button>
    </div>
  );
}

function HandoverMeta({ handover }: { handover: ActiveHandoverRow }) {
  return (
    <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.35rem' }}>
        <StatusPill label={handover.handoverTypeLabel || 'Human request'} tone="warn" />
        <StatusPill label={handover.channelLabel || handover.channel} tone="neutral" />
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-text)', margin: '0 0 0.2rem', fontWeight: 600 }}>
        {handover.contactSummary?.trim() ||
          [handover.contactDisplayName, handover.contactPhone].filter(Boolean).join(' · ') ||
          'Unknown contact'}
      </p>
      <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)', margin: 0 }}>
        {handover.reasonLabel?.trim() || 'Human escalation'} · started {formatDateTime(handover.createdAt)}
      </p>
    </div>
  );
}
