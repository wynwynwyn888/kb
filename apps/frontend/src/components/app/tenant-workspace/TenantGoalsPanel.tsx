'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAgencyAiConfig,
  listTenantPrompts,
  upsertTenantPrompt,
  type SubaccountBehaviorPolicy,
} from '@/lib/api';
import {
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SuccessBanner,
  mvpFieldHint,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
} from '@/components/app/mvp-ui';

const DEFAULT_PROFILE = 'default';

const textareaStyle = {
  ...mvpInputStyle,
  minHeight: '140px',
  resize: 'vertical' as const,
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  lineHeight: 1.5,
};

const sectionCard = {
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '1rem 1.1rem',
  marginBottom: '0.85rem',
  background: '#fff',
};

const TEMP_PRESETS = { precise: 0.35, balanced: 0.7, creative: 1.2 } as const;
type TempPreset = keyof typeof TEMP_PRESETS;

const LENGTH_PRESETS = [
  { value: '400', tokens: 400, label: 'Shorter (~400 tokens)' },
  { value: '800', tokens: 800, label: 'Balanced (~800 tokens)' },
  { value: '1500', tokens: 1500, label: 'Longer (~1500 tokens)' },
  { value: 'custom', tokens: 0, label: 'Custom' },
] as const;

function inferLengthKey(n: number): (typeof LENGTH_PRESETS)[number]['value'] {
  const targets = [400, 800, 1500] as const;
  let best: (typeof LENGTH_PRESETS)[number]['value'] = 'custom';
  let bestDiff = Infinity;
  for (const t of targets) {
    const d = Math.abs(n - t);
    if (d < bestDiff) {
      bestDiff = d;
      best = String(t) as (typeof LENGTH_PRESETS)[number]['value'];
    }
  }
  if (bestDiff > 350) return 'custom';
  return best;
}

function defaultPolicy(): SubaccountBehaviorPolicy {
  return {
    temperatureMin: 0,
    temperatureMax: 2,
    maxTokensMin: 200,
    maxTokensMax: 4000,
    allowModelOverride: true,
    allowResponseStyleOverride: true,
    allowMaxTokensOverride: true,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function numToPreset(n: number): TempPreset {
  if (!Number.isFinite(n)) return 'balanced';
  if (n <= 0.5) return 'precise';
  if (n >= 0.95) return 'creative';
  return 'balanced';
}

/** Parse saved prompt into three sections; legacy single-block content maps to Goals. */
function parsePromptSections(raw: string): { persona: string; goals: string; additional: string } {
  const t = (raw || '').trim();
  if (!t) return { persona: '', goals: '', additional: '' };
  if (!/^###\s/im.test(t)) {
    return { persona: '', goals: t, additional: '' };
  }
  const take = (title: string) => {
    const re = new RegExp(`^###\\s*${title}\\s*\\n([\\s\\S]*?)(?=^###\\s|$)`, 'im');
    const m = t.match(re);
    return m?.[1] != null ? m[1].trim() : '';
  };
  const persona = take('Bot Persona');
  const goals = take('Goals');
  const additional = take('Additional information');
  if (!persona && !goals && !additional) {
    return { persona: '', goals: t, additional: '' };
  }
  return { persona, goals, additional };
}

function buildPromptBlob(persona: string, goals: string, additional: string): string {
  return [
    '### Bot Persona',
    persona.trim(),
    '',
    '### Goals',
    goals.trim(),
    '',
    '### Additional information',
    additional.trim(),
  ].join('\n');
}

export function TenantGoalsPanel() {
  const params = useParams();
  const subaccountId = params['tenantId'] as string;
  const { token } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState(DEFAULT_PROFILE);
  const [persona, setPersona] = useState('');
  const [goals, setGoals] = useState('');
  const [additional, setAdditional] = useState('');
  const [tempPreset, setTempPreset] = useState<TempPreset>('balanced');
  const [modelOverride, setModelOverride] = useState('');
  const [maxTokens, setMaxTokens] = useState(800);
  const [lengthKey, setLengthKey] = useState<(typeof LENGTH_PRESETS)[number]['value']>('800');
  const [policy, setPolicy] = useState<SubaccountBehaviorPolicy>(defaultPolicy);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (!token || !subaccountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [prompts, agencyCfg] = await Promise.all([
          listTenantPrompts(token, subaccountId),
          getAgencyAiConfig(token).catch(() => null),
        ]);
        if (cancelled) return;

        if (agencyCfg?.subaccountBehaviorPolicy) {
          setPolicy(agencyCfg.subaccountBehaviorPolicy);
        } else {
          setPolicy(defaultPolicy());
        }

        const list = Array.isArray(prompts) ? prompts : [];
        const chosen =
          list.find(p => p.isActive) ?? list.find(p => p.name === DEFAULT_PROFILE) ?? list[0] ?? null;
        if (chosen) {
          setProfileName(chosen.name || DEFAULT_PROFILE);
          const { persona: p, goals: g, additional: a } = parsePromptSections(chosen.systemPrompt ?? '');
          setPersona(p);
          setGoals(g);
          setAdditional(a);
          const t = chosen.temperature;
          setTempPreset(numToPreset(t != null ? Number(t) : 0.7));
          setModelOverride(chosen.modelOverride ?? '');
          const mt = chosen.maxTokens != null && chosen.maxTokens > 0 ? chosen.maxTokens : 800;
          setMaxTokens(mt);
          setLengthKey(inferLengthKey(mt));
        } else {
          setProfileName(DEFAULT_PROFILE);
          setPersona('');
          setGoals('');
          setAdditional('');
          setTempPreset('balanced');
          setModelOverride('');
          setMaxTokens(800);
          setLengthKey('800');
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, subaccountId, loadAttempt]);

  const onSavePrompt = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!token) return;
    setSaving(true);
    setErr('');
    setOk('');
    try {
      const p = policy;
      const rawT = TEMP_PRESETS[tempPreset];
      const temperature = p.allowResponseStyleOverride ? clamp(rawT, p.temperatureMin, p.temperatureMax) : rawT;
      const tok = p.allowMaxTokensOverride ? clamp(maxTokens, p.maxTokensMin, p.maxTokensMax) : maxTokens;
      const systemPrompt = buildPromptBlob(persona, goals, additional);
      const mo = modelOverride.trim();
      await upsertTenantPrompt(token, {
        tenantId: subaccountId,
        name: profileName.trim() || DEFAULT_PROFILE,
        systemPrompt,
        temperature,
        maxTokens: tok,
        modelOverride: p.allowModelOverride && mo ? mo : undefined,
      });
      setOk('Saved.');
      const refreshed = await listTenantPrompts(token, subaccountId);
      const list = Array.isArray(refreshed) ? refreshed : [];
      const match = list.find(p2 => p2.name === (profileName.trim() || DEFAULT_PROFILE)) ?? list[0];
      if (match) {
        setProfileName(match.name || DEFAULT_PROFILE);
        const { persona: p2, goals: g, additional: a } = parsePromptSections(match.systemPrompt ?? '');
        setPersona(p2);
        setGoals(g);
        setAdditional(a);
        setTempPreset(numToPreset(match.temperature != null ? Number(match.temperature) : 0.7));
        setModelOverride(match.modelOverride ?? '');
        const mt2 = match.maxTokens != null && match.maxTokens > 0 ? match.maxTokens : 800;
        setMaxTokens(mt2);
        setLengthKey(inferLengthKey(mt2));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Your bot" eyebrow="This subaccount" />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: '640px' }}>
        Who the bot is, what it should achieve, and extra business context. Agency-wide Master Prompt is configured under the
        agency account; knowledge documents are under Knowledge Base.
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
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Try again
          </button>
        </div>
      )}
      {ok ? <SuccessBanner message={ok} /> : null}

      {loading && !err ? <LoadingBlock message="Loading…" /> : null}

      {!loading && !err ? (
        <form onSubmit={onSavePrompt}>
          <div style={sectionCard}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 0.5rem', color: '#0f172a' }}>Bot persona</h2>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.5rem' }}>Identity, tone, and how the bot should sound.</p>
            <textarea
              style={textareaStyle}
              value={persona}
              onChange={e => setPersona(e.target.value)}
              aria-label="Bot Persona"
            />
          </div>
          <div style={sectionCard}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 0.5rem', color: '#0f172a' }}>Goals</h2>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.5rem' }}>Outcomes, priorities, and what success looks like.</p>
            <textarea style={textareaStyle} value={goals} onChange={e => setGoals(e.target.value)} aria-label="Goals" />
          </div>
          <div style={sectionCard}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 0.5rem', color: '#0f172a' }}>Additional Information</h2>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.5rem' }}>
              Guardrails, hours, products, or anything else the bot should know.
            </p>
            <textarea
              style={textareaStyle}
              value={additional}
              onChange={e => setAdditional(e.target.value)}
              aria-label="Additional information"
            />
          </div>

          <div
            style={{
              ...sectionCard,
              display: 'grid',
              gap: '0.85rem',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            }}
          >
            <div>
              <label style={mvpLabelStyle}>Response style</label>
              <select
                value={tempPreset}
                onChange={e => setTempPreset(e.target.value as TempPreset)}
                style={mvpInputStyle}
                disabled={!policy.allowResponseStyleOverride}
              >
                <option value="precise">Precise</option>
                <option value="balanced">Balanced</option>
                <option value="creative">Creative</option>
              </select>
              <p style={mvpFieldHint}>
                Balanced is the usual default. Your agency can narrow how far Precise and Creative are allowed to go.
              </p>
            </div>
            <div>
              <span style={mvpLabelStyle}>Reply length</span>
              <select
                value={lengthKey}
                onChange={e => {
                  const v = e.target.value as (typeof LENGTH_PRESETS)[number]['value'];
                  setLengthKey(v);
                  const opt = LENGTH_PRESETS.find(o => o.value === v);
                  if (opt && opt.value !== 'custom') setMaxTokens(opt.tokens);
                }}
                style={mvpInputStyle}
                disabled={!policy.allowMaxTokensOverride}
              >
                {LENGTH_PRESETS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={mvpLabelStyle}>Max tokens</label>
              <input
                type="number"
                value={maxTokens}
                onChange={e => setMaxTokens(parseInt(e.target.value, 10) || 0)}
                style={mvpInputStyle}
                disabled={!policy.allowMaxTokensOverride}
                min={policy.maxTokensMin}
                max={policy.maxTokensMax}
              />
            </div>
            <div>
              <label style={mvpLabelStyle}>Model override (optional)</label>
              <input
                style={mvpInputStyle}
                value={modelOverride}
                onChange={e => setModelOverride(e.target.value)}
                placeholder="Model id for this subaccount"
                autoComplete="off"
                disabled={!policy.allowModelOverride}
              />
              {!policy.allowModelOverride ? (
                <p style={mvpFieldHint}>Your agency has disabled model overrides for subaccounts.</p>
              ) : null}
            </div>
          </div>

          <details style={{ marginBottom: '0.75rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: '#64748b' }}>Advanced: profile name</summary>
            <div style={{ marginTop: '0.65rem' }}>
              <label style={mvpLabelStyle}>Profile name</label>
              <input
                style={{ ...mvpInputStyle, maxWidth: '280px' }}
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                autoComplete="off"
              />
              <p style={mvpFieldHint}>Default is &quot;default&quot;.</p>
            </div>
          </details>

          <button type="submit" style={mvpPrimaryButtonStyle} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
