'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAgencyAiConfig,
  saveAgencyAiConfig,
  saveSubaccountBehaviorPolicy,
  type AgencyProviderSnapshot,
  type SubaccountBehaviorPolicy,
} from '@/lib/api';
import { getModelFieldForProvider, PROVIDER_LABEL } from '@/lib/ai-model-options';
import { hasLiveGeneration, snapshotFor } from '@/lib/ai-provider-options';
import {
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  SectionCard,
  SuccessBanner,
  mvpFieldHint,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpSelectStyle,
} from '@/components/app/mvp-ui';

/** Stored on the provider row for stack fallback. */
const PROVIDER_STACK_DEFAULTS = { temperature: 0.7, maxTokens: 800 };

const strip: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  columnGap: '1.1rem',
  rowGap: '0.4rem',
  alignItems: 'center',
  fontSize: '0.78rem',
  color: '#334155',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '0.5rem 0.7rem',
  marginBottom: '0.85rem',
};

const defaultBehavior = (): SubaccountBehaviorPolicy => ({
  temperatureMin: 0,
  temperatureMax: 2,
  maxTokensMin: 200,
  maxTokensMax: 4000,
  allowModelOverride: true,
  allowResponseStyleOverride: true,
  allowMaxTokensOverride: true,
});

export default function AgencyAiSettingsPage() {
  const { token } = useAuth();
  const [loadKey, setLoadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [bootstrapErr, setBootstrapErr] = useState('');
  const [err, setErr] = useState('');
  const [policyErr, setPolicyErr] = useState('');
  const [ok, setOk] = useState('');
  const [policyOk, setPolicyOk] = useState('');

  const [selectedProvider, setSelectedProvider] = useState('OPENAI');
  const [apiKey, setApiKey] = useState('');
  const [minimaxGroupId, setMinimaxGroupId] = useState('');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');

  const [activeProvider, setActiveProvider] = useState('OPENAI');
  const [activeModel, setActiveModel] = useState('gpt-4o-mini');
  const [activeHasKey, setActiveHasKey] = useState(false);
  const [keysPresent, setKeysPresent] = useState<Partial<Record<string, boolean>>>({});
  const [providerSnapshots, setProviderSnapshots] = useState<
    Partial<Record<string, AgencyProviderSnapshot>> | undefined
  >();
  const [setAsActive, setSetAsActive] = useState(true);
  const [policy, setPolicy] = useState<SubaccountBehaviorPolicy>(defaultBehavior);

  const modelUi = useMemo(() => getModelFieldForProvider(selectedProvider), [selectedProvider]);

  const hasKeyThis = Boolean(keysPresent[selectedProvider]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setBootstrapErr('');
      try {
        const c = await getAgencyAiConfig(token);
        if (cancelled) return;
        const ap = c.activeProvider ?? c.provider;
        setActiveProvider(ap);
        setActiveModel(c.activeModel ?? c.defaultModel);
        const apKey = c.activeProvider ?? c.provider ?? 'OPENAI';
        setActiveHasKey(Boolean(c.keysPresent?.[apKey] ?? c.hasApiKey));
        setKeysPresent(c.keysPresent ?? {});
        setProviderSnapshots(c.providerSnapshots);
        if (c.subaccountBehaviorPolicy) {
          setPolicy(c.subaccountBehaviorPolicy);
        }

        const edit = c.activeProvider ?? c.provider;
        if (edit) {
          setSelectedProvider(edit);
          const snapshots = c.providerSnapshots;
          const s = snapshotFor(edit, snapshots, {
            defaultModel: 'gpt-4o-mini',
            maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
            temperature: PROVIDER_STACK_DEFAULTS.temperature,
          });
          const m = getModelFieldForProvider(edit);
          if (m.mode === 'list' && m.options.some(o => o.value === s.defaultModel)) {
            setDefaultModel(s.defaultModel);
          } else if (m.mode === 'list') {
            setDefaultModel(m.defaultModel);
          } else {
            setDefaultModel(s.defaultModel);
          }
          if (edit === 'MINIMAX') {
            setMinimaxGroupId(s.minimaxGroupId?.trim() ?? '');
          } else {
            setMinimaxGroupId('');
          }
        }
      } catch (e) {
        if (!cancelled) setBootstrapErr(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, loadKey]);

  const onSubmitProviders = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (setAsActive && !hasLiveGeneration(selectedProvider)) {
      setErr('Only OpenAI or MiniMax can be the active live provider with the current stack. Uncheck or switch provider.');
      return;
    }
    if (selectedProvider === 'MINIMAX' && !apiKey.trim() && !hasKeyThis) {
      setErr('MiniMax needs an API key. Paste your key to save.');
      return;
    }

    setErr('');
    setOk('');
    setSaving(true);
    try {
      const saved = await saveAgencyAiConfig(token, {
        provider: selectedProvider,
        apiKey: apiKey.trim() || undefined,
        defaultModel,
        temperature: PROVIDER_STACK_DEFAULTS.temperature,
        maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
        // JSON.stringify omits `undefined`; the API requires an explicit boolean so active_ai_provider is updated
        // when the checkbox is on (default) or off.
        setAsActive: setAsActive !== false,
        ...(selectedProvider === 'MINIMAX' ? { minimaxGroupId: minimaxGroupId.trim() } : {}),
      });
      setOk('Provider settings saved');
      setApiKey('');
      setActiveProvider(saved.activeProvider ?? saved.provider);
      setActiveModel(saved.activeModel ?? saved.defaultModel);
      if (saved.hasApiKey != null) setActiveHasKey(Boolean(saved.hasApiKey));
      if (saved.keysPresent) setKeysPresent(saved.keysPresent);
      if (saved.provider) setSelectedProvider(saved.provider);
      if (saved.providerSnapshots) setProviderSnapshots(saved.providerSnapshots);
      if (saved.defaultModel) setDefaultModel(saved.defaultModel);
      // Re-align checkbox with the row now shown (active stack) after save.
      setSetAsActive(
        hasLiveGeneration(String(saved.activeProvider || saved.provider || 'OPENAI')),
      );
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const applySubaccountOverrideMaster = (on: boolean) => {
    setPolicy(p => ({
      ...p,
      allowModelOverride: on,
      allowResponseStyleOverride: on,
      allowMaxTokensOverride: on,
    }));
  };

  const onSubmitPolicy = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setPolicyErr('');
    setPolicyOk('');
    setSavingPolicy(true);
    try {
      const saved = await saveSubaccountBehaviorPolicy(token, policy);
      setPolicy(saved);
      setPolicyOk('Policy saved');
    } catch (er) {
      setPolicyErr(er instanceof Error ? er.message : 'Save failed');
    } finally {
      setSavingPolicy(false);
    }
  };

  const activeNeedsKey = ['OPENAI', 'MINIMAX'].includes((activeProvider || '').toUpperCase());
  const activeKeyOk = !activeNeedsKey || activeHasKey;

  const modelIsText = modelUi.mode === 'text';

  return (
    <div>
      <PageHeader title="AI & models" eyebrow="Agency account" />
      <p style={{ fontSize: '0.84rem', color: '#64748b', margin: '0 0 0.9rem', lineHeight: 1.45, maxWidth: '40rem' }}>
        Provider keys and the live default model. Subaccount bot copy and response style are configured per subaccount; this
        page only sets what subaccounts are allowed to change.
      </p>

      {loading ? (
        <LoadingBlock message="Loading…" />
      ) : bootstrapErr ? (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorBanner message={bootstrapErr} />
          <button
            type="button"
            onClick={() => {
              setBootstrapErr('');
              setLoadKey(k => k + 1);
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
            Retry
          </button>
        </div>
      ) : (
        <>
          <div style={strip}>
            <span>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>Active provider</span> {activeProvider}
            </span>
            <span>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>Active model</span> <span style={{ fontFamily: 'ui-monospace, monospace' }}>{activeModel}</span>
            </span>
            <span style={{ color: !activeKeyOk ? '#b91c1c' : undefined }}>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>API key (active provider)</span>{' '}
              {activeKeyOk ? 'on file' : 'missing'}
            </span>
            <span>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>Editing provider</span> {selectedProvider}
              {setAsActive && !hasLiveGeneration(selectedProvider) ? (
                <span style={{ color: '#94a3b8' }}> — not live; uncheck to store only</span>
              ) : null}
            </span>
          </div>

          <SectionCard
            title="Provider credentials & default model"
            subtitle="OpenAI and MiniMax are supported as the live stack; other providers are stored for future use."
          >
            {err ? <ErrorBanner message={err} /> : null}
            {ok ? <SuccessBanner message={ok} /> : null}
            <form
              onSubmit={onSubmitProviders}
              style={{ maxWidth: '540px', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
            >
              <label style={mvpLabelStyle}>
                Provider
                <select
                  value={selectedProvider}
                  onChange={e => {
                    const p = e.target.value;
                    setSelectedProvider(p);
                    setApiKey('');
                    // Only the live row should be pre-checked; switching away from the active row must not keep
                    // "set as active" true or the next save will rotate the agency stack (e.g. OpenAI overwrites MINIMAX).
                    setSetAsActive(p === activeProvider);
                    const s = snapshotFor(p, providerSnapshots, {
                      defaultModel: p === 'MINIMAX' ? 'MiniMax-M2.7' : 'gpt-4o-mini',
                      maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
                      temperature: PROVIDER_STACK_DEFAULTS.temperature,
                    });
                    const m = getModelFieldForProvider(p);
                    if (m.mode === 'list' && m.options.some(o => o.value === s.defaultModel)) {
                      setDefaultModel(s.defaultModel);
                    } else if (m.mode === 'list') {
                      setDefaultModel(m.defaultModel);
                    } else {
                      setDefaultModel(s.defaultModel);
                    }
                    if (p === 'MINIMAX') {
                      setMinimaxGroupId(s.minimaxGroupId?.trim() ?? '');
                    } else {
                      setMinimaxGroupId('');
                    }
                  }}
                  style={mvpSelectStyle}
                >
                  {(['MINIMAX', 'OPENAI', 'GOOGLE', 'ANTHROPIC', 'AZURE', 'CUSTOM'] as const).map(p => (
                    <option key={p} value={p}>
                      {PROVIDER_LABEL[p] ?? p}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={setAsActive}
                  onChange={e => setSetAsActive(e.target.checked)}
                  disabled={!hasLiveGeneration(selectedProvider)}
                />
                Use this provider as active for generation after save
                {!hasLiveGeneration(selectedProvider) ? (
                  <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>— only OpenAI or MiniMax are live in this stack</span>
                ) : null}
              </label>

              <label style={mvpLabelStyle}>
                API key
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={hasKeyThis ? 'Leave blank to keep saved key' : 'Required to store this provider'}
                  autoComplete="new-password"
                  style={{ ...mvpInputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
              </label>
              {hasKeyThis ? <p style={mvpFieldHint}>A key is on file for this provider.</p> : null}

              {selectedProvider === 'MINIMAX' ? (
                <label style={mvpLabelStyle}>
                  Group / org id (if your MiniMax project requires it)
                  <input
                    value={minimaxGroupId}
                    onChange={e => setMinimaxGroupId(e.target.value)}
                    style={mvpInputStyle}
                    placeholder="Optional"
                    autoComplete="off"
                  />
                </label>
              ) : null}

              {modelIsText ? (
                <label style={mvpLabelStyle}>
                  Default model id
                  <input value={defaultModel} onChange={e => setDefaultModel(e.target.value)} style={mvpInputStyle} />
                </label>
              ) : (
                <label style={mvpLabelStyle}>
                  Default model
                  <select
                    value={defaultModel}
                    onChange={e => setDefaultModel(e.target.value)}
                    style={mvpSelectStyle}
                  >
                    {modelUi.mode === 'list' &&
                      modelUi.groups &&
                      modelUi.groups.map(g => (
                        <optgroup key={g.label} label={g.label}>
                          {g.options.map(o => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    {modelUi.mode === 'list' && !modelUi.groups &&
                      modelUi.options.map(o => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              <p style={mvpFieldHint}>Subaccount copy lives in each subaccount’s bot settings.</p>

              <button
                type="submit"
                disabled={saving}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: saving ? 0.85 : 1 }}
              >
                {saving ? 'Saving…' : 'Save provider settings'}
              </button>
            </form>
          </SectionCard>

          <SectionCard
            title="Subaccount policy limits"
            subtitle="Upper and lower bounds for what subaccounts may set on their own bot. Not day-to-day tuning—that happens in each subaccount."
          >
            {policyErr ? <ErrorBanner message={policyErr} /> : null}
            {policyOk ? <SuccessBanner message={policyOk} /> : null}
            <form
              onSubmit={onSubmitPolicy}
              style={{ maxWidth: '540px', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={
                    policy.allowModelOverride &&
                    policy.allowResponseStyleOverride &&
                    policy.allowMaxTokensOverride
                  }
                  onChange={e => applySubaccountOverrideMaster(e.target.checked)}
                />
                Allow subaccounts to change model, response style, and max tokens
              </label>
              <p style={{ ...mvpFieldHint, marginTop: 0 }}>Off locks all three; you can also change each option below on its own.</p>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>
                <strong>Style range (numeric)</strong> is the min/max of the &quot;creativity&quot; scale (0–2) subaccounts may
                use. It is not a bot personality—only the allowed band.
              </p>
              <div style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                <label style={mvpLabelStyle}>
                  Minimum style (0–2)
                  <input
                    type="number"
                    value={policy.temperatureMin}
                    onChange={e => {
                      const n = parseFloat(e.target.value);
                      setPolicy(p => {
                        if (!Number.isFinite(n)) return p;
                        const tMax = p.temperatureMax;
                        const tMin = Math.min(n, tMax);
                        return { ...p, temperatureMin: Math.max(0, tMin) };
                      });
                    }}
                    style={mvpInputStyle}
                    min={0}
                    max={2}
                    step={0.05}
                  />
                </label>
                <label style={mvpLabelStyle}>
                  Maximum style (0–2)
                  <input
                    type="number"
                    value={policy.temperatureMax}
                    onChange={e => {
                      const n = parseFloat(e.target.value);
                      setPolicy(p => {
                        if (!Number.isFinite(n)) return p;
                        const tMin = p.temperatureMin;
                        const tMax = Math.max(n, tMin);
                        return { ...p, temperatureMax: Math.min(2, tMax) };
                      });
                    }}
                    style={mvpInputStyle}
                    min={0}
                    max={2}
                    step={0.05}
                  />
                </label>
                <label style={mvpLabelStyle}>
                  Minimum max tokens (per reply)
                  <input
                    type="number"
                    value={policy.maxTokensMin}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10) || 0;
                      setPolicy(p => ({ ...p, maxTokensMin: n, maxTokensMax: n > p.maxTokensMax ? n : p.maxTokensMax }));
                    }}
                    style={mvpInputStyle}
                    min={0}
                  />
                </label>
                <label style={mvpLabelStyle}>
                  Maximum max tokens (per reply)
                  <input
                    type="number"
                    value={policy.maxTokensMax}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10) || 0;
                      setPolicy(p => ({ ...p, maxTokensMax: n, maxTokensMin: n < p.maxTokensMin ? n : p.maxTokensMin }));
                    }}
                    style={mvpInputStyle}
                    min={0}
                  />
                </label>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '-0.1rem 0 0' }}>
                Subaccount reply length and max-token fields must stay within the token limits above. Style picks on the
                subaccount (Precise / Balanced / Creative) must stay within the style min/max.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={policy.allowResponseStyleOverride}
                  onChange={e => setPolicy(p => ({ ...p, allowResponseStyleOverride: e.target.checked }))}
                />
                Subaccounts may change response style
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={policy.allowMaxTokensOverride}
                  onChange={e => setPolicy(p => ({ ...p, allowMaxTokensOverride: e.target.checked }))}
                />
                Subaccounts may change reply length and max tokens
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={policy.allowModelOverride}
                  onChange={e => setPolicy(p => ({ ...p, allowModelOverride: e.target.checked }))}
                />
                Subaccounts may set an optional model override
              </label>
              <button
                type="submit"
                disabled={savingPolicy}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingPolicy ? 0.85 : 1 }}
              >
                {savingPolicy ? 'Saving…' : 'Save policy'}
              </button>
            </form>
          </SectionCard>
        </>
      )}
    </div>
  );
}
