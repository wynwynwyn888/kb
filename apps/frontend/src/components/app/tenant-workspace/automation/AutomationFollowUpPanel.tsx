'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTenantFollowUpSettings,
  patchTenantFollowUpSettings,
  type FollowUpHoursTimezoneMode,
  type FollowUpStepSetting,
  type TenantFollowUpSettings,
} from '@/lib/api';
import {
  ErrorBanner,
  LoadingBlock,
  SectionCard,
  mvpDangerButtonStyle,
  mvpPrimaryButtonStyle,
  mvpSecondaryButtonStyle,
} from '@/components/app/mvp-ui';

function btn(kind: 'primary' | 'secondary' | 'danger', disabled: boolean): CSSProperties {
  const base =
    kind === 'primary' ? mvpPrimaryButtonStyle : kind === 'danger' ? mvpDangerButtonStyle : mvpSecondaryButtonStyle;
  return {
    ...base,
    opacity: disabled ? 0.58 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

function cardStyle(): CSSProperties {
  return {
    border: '1px solid var(--aisbp-border)',
    borderRadius: 10,
    padding: '0.85rem 1rem',
    marginBottom: '0.75rem',
    background: 'var(--aisbp-surface)',
  };
}

export function AutomationFollowUpPanel() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();

  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [followUp, setFollowUp] = useState<TenantFollowUpSettings | null>(null);
  const [banner, setBanner] = useState('');

  const load = useCallback(async () => {
    if (!token || !tenantId) return;
    setLoading(true);
    try {
      const f = await getTenantFollowUpSettings(token, tenantId);
      setFollowUp(f);
      setLoadErr('');
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load follow-up settings');
    } finally {
      setLoading(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!token || !tenantId || !followUp) return;
    setBusy('save-follow');
    setBanner('');
    try {
      const next = await patchTenantFollowUpSettings(token, tenantId, followUp);
      setFollowUp(next);
      setBanner('Saved.');
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const updateStep = (idx: number, patch: Partial<FollowUpStepSetting>) => {
    setFollowUp(prev => {
      if (!prev) return prev;
      const steps = [...prev.steps];
      const cur = steps[idx];
      if (!cur) return prev;
      steps[idx] = { ...cur, ...patch };
      return { ...prev, steps };
    });
  };

  const addStep = () => {
    setFollowUp(prev => {
      if (!prev) return prev;
      if (prev.steps.length >= 5) return prev;
      const n = prev.steps.length + 1;
      return {
        ...prev,
        steps: [
          ...prev.steps,
          {
            stepNumber: n,
            delayAmount: 2,
            delayUnit: 'hours',
            mode: 'fixed',
            fixedMessage: '',
            enabled: true,
          },
        ],
      };
    });
  };

  const removeStep = (idx: number) => {
    setFollowUp(prev => {
      if (!prev) return prev;
      const steps = prev.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepNumber: i + 1 }));
      return { ...prev, steps };
    });
  };

  const patchDay = (key: string, patch: Partial<{ enabled: boolean; start: string; end: string }>) => {
    setFollowUp(prev => {
      if (!prev) return prev;
      const cur = prev.activeHoursWindows[key] ?? { enabled: false, start: '09:00', end: '17:00' };
      return {
        ...prev,
        activeHoursWindows: {
          ...prev.activeHoursWindows,
          [key]: { ...cur, ...patch },
        },
      };
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {loadErr ? <ErrorBanner message={loadErr} /> : null}

      <SectionCard title="Workspace scope" subtitle="Follow-up settings currently apply across this workspace." accent="muted">
        <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55 }}>
          The active assistant uses these settings when replying. Scheduling/execution may be gated by conversation state and rollout flags.
        </p>
      </SectionCard>

      <SectionCard
        title="Follow-up assistant"
        subtitle="Stored configuration for when a contact stops replying. Sending is not wired yet."
        accent="muted"
      >
        {loading || !followUp ? (
          <LoadingBlock />
        ) : (
          <>
            <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted)', lineHeight: 1.55, margin: '0 0 1rem' }}>
              <strong>Initial scenario:</strong> contact stopped replying — sequence below applies after quiet periods you configure.
            </p>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <input
                type="checkbox"
                checked={followUp.enabled}
                onChange={e => setFollowUp({ ...followUp, enabled: e.target.checked })}
              />
              <span style={{ fontWeight: 600 }}>Enable follow-up assistant</span>
            </label>

            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.85rem' }}>
              Maximum follow-ups (1–5)
              <select
                value={followUp.maxFollowUps}
                onChange={e => setFollowUp({ ...followUp, maxFollowUps: Number(e.target.value) })}
                style={{ display: 'block', marginTop: '0.25rem', padding: '0.4rem', borderRadius: 8 }}
              >
                {[1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.35rem' }}>Stop follow-up when</p>
            <div style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.85rem', fontSize: '0.85rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.stopOnCustomerReply}
                  onChange={e => setFollowUp({ ...followUp, stopOnCustomerReply: e.target.checked })}
                />
                Customer replies
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.stopOnBookingCompleted}
                  onChange={e => setFollowUp({ ...followUp, stopOnBookingCompleted: e.target.checked })}
                />
                Booking completed
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.stopOnEscalated}
                  onChange={e => setFollowUp({ ...followUp, stopOnEscalated: e.target.checked })}
                />
                Conversation escalated
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.stopOnOptOut}
                  onChange={e => setFollowUp({ ...followUp, stopOnOptOut: e.target.checked })}
                />
                Customer says stop / not interested
              </label>
            </div>

            <div style={cardStyle()}>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Follow-up active hours</p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.65rem', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={followUp.businessHoursOnly}
                  onChange={e => setFollowUp({ ...followUp, businessHoursOnly: e.target.checked })}
                />
                Only send during active hours (stored for scheduling)
              </label>
              <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.65rem' }}>
                Timezone basis
                <select
                  value={followUp.activeHoursTimezoneMode}
                  onChange={e =>
                    setFollowUp({ ...followUp, activeHoursTimezoneMode: e.target.value as FollowUpHoursTimezoneMode })
                  }
                  style={{ display: 'block', marginTop: '0.25rem', padding: '0.4rem', borderRadius: 8 }}
                >
                  <option value="BUSINESS">Business / workspace timezone</option>
                  <option value="CONTACT">Contact timezone (when known)</option>
                </select>
              </label>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--aisbp-border)' }}>
                      <th style={{ padding: '0.35rem' }}>Day</th>
                      <th style={{ padding: '0.35rem' }}>On</th>
                      <th style={{ padding: '0.35rem' }}>Start</th>
                      <th style={{ padding: '0.35rem' }}>End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map(d => {
                      const w = followUp.activeHoursWindows[d.key] ?? { enabled: false, start: '09:00', end: '17:00' };
                      return (
                        <tr key={d.key} style={{ borderBottom: '1px solid var(--aisbp-border)' }}>
                          <td style={{ padding: '0.35rem' }}>{d.label}</td>
                          <td style={{ padding: '0.35rem' }}>
                            <input
                              type="checkbox"
                              checked={w.enabled}
                              onChange={e => patchDay(d.key, { enabled: e.target.checked })}
                            />
                          </td>
                          <td style={{ padding: '0.35rem' }}>
                            <input
                              type="time"
                              value={w.start}
                              onChange={e => patchDay(d.key, { start: e.target.value })}
                              disabled={!w.enabled}
                              style={{ padding: '0.25rem' }}
                            />
                          </td>
                          <td style={{ padding: '0.35rem' }}>
                            <input
                              type="time"
                              value={w.end}
                              onChange={e => patchDay(d.key, { end: e.target.value })}
                              disabled={!w.enabled}
                              style={{ padding: '0.25rem' }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: '0.76rem', color: 'var(--aisbp-muted)', lineHeight: 1.45, marginTop: '0.65rem' }}>
                When scheduling ships: if a step becomes due outside these windows, it will wait for the next allowed window
                (preview — not enforced yet).
              </p>
            </div>

            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Follow-up sequence (up to 5)</p>
            {followUp.steps.map((step, idx) => (
              <div key={idx} style={cardStyle()}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.35rem' }}>Step {step.stepNumber}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.78rem' }}>Send after</span>
                  <input
                    type="number"
                    min={1}
                    value={step.delayAmount}
                    onChange={e => updateStep(idx, { delayAmount: Math.max(1, Number(e.target.value) || 1) })}
                    style={{ width: 72, padding: '0.3rem', borderRadius: 6 }}
                  />
                  <select
                    value={step.delayUnit}
                    onChange={e =>
                      updateStep(idx, { delayUnit: e.target.value as FollowUpStepSetting['delayUnit'] })
                    }
                    style={{ padding: '0.3rem', borderRadius: 6 }}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                  <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted)' }}>of no reply</span>
                </div>
                <label style={{ fontSize: '0.78rem', marginRight: '0.5rem' }}>
                  Send mode{' '}
                  <select
                    value={step.mode}
                    onChange={e => updateStep(idx, { mode: e.target.value as 'fixed' | 'ai' })}
                    style={{ padding: '0.3rem', borderRadius: 6 }}
                  >
                    <option value="fixed">Fixed message</option>
                    <option value="ai">AI decides</option>
                  </select>
                </label>
                {step.mode === 'fixed' ? (
                  <textarea
                    value={step.fixedMessage ?? ''}
                    onChange={e => updateStep(idx, { fixedMessage: e.target.value })}
                    placeholder="Fixed message"
                    rows={2}
                    style={{ width: '100%', marginTop: '0.35rem', padding: '0.35rem', borderRadius: 8 }}
                  />
                ) : (
                  <textarea
                    value={step.aiInstruction ?? ''}
                    onChange={e => updateStep(idx, { aiInstruction: e.target.value })}
                    placeholder="Instruction for AI (stored only)"
                    rows={2}
                    style={{ width: '100%', marginTop: '0.35rem', padding: '0.35rem', borderRadius: 8 }}
                  />
                )}
                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem' }}>
                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={e => updateStep(idx, { enabled: e.target.checked })}
                  />
                  Step enabled
                </label>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => removeStep(idx)}
                  style={{ ...btn('danger', busy !== null), marginTop: '0.35rem', fontSize: '0.78rem' }}
                >
                  Delete step
                </button>
              </div>
            ))}
            {followUp.steps.length < 5 ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => addStep()}
                style={{ ...btn('secondary', busy !== null), marginBottom: '0.75rem', fontSize: '0.85rem' }}
              >
                Add step
              </button>
            ) : null}

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void save()}
              style={{ ...btn('primary', busy !== null), fontSize: '0.9rem' }}
            >
              Save follow-up settings
            </button>
            {banner ? (
              <p style={{ marginTop: '0.65rem', fontSize: '0.85rem', color: 'var(--aisbp-muted)' }}>{banner}</p>
            ) : null}
          </>
        )}
      </SectionCard>
    </div>
  );
}
