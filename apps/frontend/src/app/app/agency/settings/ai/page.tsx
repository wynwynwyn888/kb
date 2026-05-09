'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAgencyAiConfig,
  postAgencyAiModelHealthTest,
  saveAgencyAiConfig,
  saveSubaccountBehaviorPolicy,
  type AgencyProviderSnapshot,
  type AiModelHealthSnapshot,
  type SubaccountBehaviorPolicy,
} from '@/lib/api';
import type { LiveAiCatalogDto } from '@/lib/api';
import { catalogProviderIds, getModelFieldForProvider, PROVIDER_LABEL } from '@/lib/ai-model-options';
import { MINIMAX_DEFAULT_API_BASE, OPENAI_DEFAULT_API_BASE } from '@aisbp/types';
import { hasLiveGeneration, snapshotFor } from '@/lib/ai-provider-options';
import {
  ErrorBanner,
  formatDateTime,
  KeyValueRows,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  SuccessBanner,
  mvpButtonStyle,
  mvpFieldHint,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpSecondaryButtonStyle,
  mvpSelectStyle,
} from '@/components/app/mvp-ui';

/** Stored on the provider row for stack fallback. */
const PROVIDER_STACK_DEFAULTS = { temperature: 0.7, maxTokens: 800 };

const defaultBehavior = (): SubaccountBehaviorPolicy => ({
  temperatureMin: 0,
  temperatureMax: 2,
  maxTokensMin: 200,
  maxTokensMax: 4000,
  allowModelOverride: true,
  allowResponseStyleOverride: true,
  allowMaxTokensOverride: true,
});

function defaultEndpointFor(provider: string): string {
  return provider.toUpperCase() === 'MINIMAX' ? MINIMAX_DEFAULT_API_BASE : OPENAI_DEFAULT_API_BASE;
}

function healthAppliesToSelection(
  snap: AiModelHealthSnapshot | null | undefined,
  provider: string,
  model: string,
): boolean {
  if (!snap) return false;
  return snap.lastHealthProvider.toUpperCase() === provider.toUpperCase() && snap.lastHealthModel.trim() === model.trim();
}

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
  const [endpointOverride, setEndpointOverride] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [activeProvider, setActiveProvider] = useState('OPENAI');
  const [activeModel, setActiveModel] = useState('gpt-4o-mini');
  const [activeHasKey, setActiveHasKey] = useState(false);
  const [keysPresent, setKeysPresent] = useState<Partial<Record<string, boolean>>>({});
  const [providerSnapshots, setProviderSnapshots] = useState<
    Partial<Record<string, AgencyProviderSnapshot>> | undefined
  >();
  const [healthSnap, setHealthSnap] = useState<AiModelHealthSnapshot | null>(null);
  const [liveAiCatalog, setLiveAiCatalog] = useState<LiveAiCatalogDto | null>(null);
  const [setAsActive, setSetAsActive] = useState(true);
  const [policy, setPolicy] = useState<SubaccountBehaviorPolicy>(defaultBehavior);

  const [testing, setTesting] = useState(false);
  const [testErr, setTestErr] = useState('');
  const [testOk, setTestOk] = useState('');

  const modelUi = useMemo(
    () => getModelFieldForProvider(selectedProvider, liveAiCatalog),
    [selectedProvider, liveAiCatalog],
  );

  const hasKeyThis = Boolean(keysPresent[selectedProvider]);

  const healthForForm = useMemo(
    () => healthAppliesToSelection(healthSnap, selectedProvider, defaultModel),
    [healthSnap, selectedProvider, defaultModel],
  );

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
        setHealthSnap(c.aiModelHealthSnapshot ?? null);
        setLiveAiCatalog(c.liveAiCatalog ?? null);
        if (c.subaccountBehaviorPolicy) {
          setPolicy(c.subaccountBehaviorPolicy);
        }

        const edit = c.activeProvider ?? c.provider;
        if (edit && (edit === 'OPENAI' || edit === 'MINIMAX')) {
          setSelectedProvider(edit);
          const snapshots = c.providerSnapshots;
          const s = snapshotFor(edit, snapshots, {
            defaultModel: 'gpt-4o-mini',
            maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
            temperature: PROVIDER_STACK_DEFAULTS.temperature,
          });
          const m = getModelFieldForProvider(edit, c.liveAiCatalog ?? null);
          if (m.mode === 'list' && m.options.some(o => o.value === s.defaultModel)) {
            setDefaultModel(s.defaultModel);
          } else {
            setDefaultModel(m.defaultModel);
          }
          if (edit === 'MINIMAX') {
            setMinimaxGroupId(s.minimaxGroupId?.trim() ?? '');
          } else {
            setMinimaxGroupId('');
          }
          const ep = s.endpoint?.trim() ?? '';
          setEndpointOverride(ep);
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
      setErr('Only OpenAI or MiniMax can be used for live replies right now.');
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
      const baseDefault = defaultEndpointFor(selectedProvider);
      const ep = endpointOverride.trim();
      const payload: Parameters<typeof saveAgencyAiConfig>[1] = {
        provider: selectedProvider,
        apiKey: apiKey.trim() || undefined,
        defaultModel,
        temperature: PROVIDER_STACK_DEFAULTS.temperature,
        maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
        setAsActive: setAsActive !== false,
        ...(selectedProvider === 'MINIMAX' ? { minimaxGroupId: minimaxGroupId.trim() } : {}),
      };
      if (advancedOpen && ep && ep !== baseDefault) {
        payload.endpoint = ep;
      } else if (advancedOpen && !ep) {
        payload.endpoint = '';
      }

      const saved = await saveAgencyAiConfig(token, payload);
      setOk('AI provider saved');
      setApiKey('');
      setActiveProvider(saved.activeProvider ?? saved.provider);
      setActiveModel(saved.activeModel ?? saved.defaultModel);
      if (saved.hasApiKey != null) setActiveHasKey(Boolean(saved.hasApiKey));
      if (saved.keysPresent) setKeysPresent(saved.keysPresent);
      if (saved.provider) setSelectedProvider(saved.provider);
      if (saved.providerSnapshots) setProviderSnapshots(saved.providerSnapshots);
      if (saved.defaultModel) setDefaultModel(saved.defaultModel);
      setHealthSnap(saved.aiModelHealthSnapshot ?? null);
      setLiveAiCatalog(saved.liveAiCatalog ?? null);
      setSetAsActive(hasLiveGeneration(String(saved.activeProvider || saved.provider || 'OPENAI')));
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onTestModel = async () => {
    if (!token) return;
    setTestErr('');
    setTestOk('');
    setTesting(true);
    try {
      const r = await postAgencyAiModelHealthTest(token, {
        provider: selectedProvider,
        model: defaultModel,
        optionalUseSavedKey: true,
      });
      const c = await getAgencyAiConfig(token);
      setHealthSnap(c.aiModelHealthSnapshot ?? null);
      setLiveAiCatalog(c.liveAiCatalog ?? null);
      if (r.status === 'PASS') {
        setTestOk(`Health check passed for ${r.provider} / ${r.model} (${r.latencyMs} ms).`);
      } else {
        setTestErr(r.errorSummary || 'Health check failed.');
      }
    } catch (er) {
      setTestErr(er instanceof Error ? er.message : 'Test failed');
    } finally {
      setTesting(false);
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
      setPolicyOk('Workspace limits saved');
    } catch (er) {
      setPolicyErr(er instanceof Error ? er.message : 'Save failed');
    } finally {
      setSavingPolicy(false);
    }
  };

  const activeNeedsKey = ['OPENAI', 'MINIMAX'].includes((activeProvider || '').toUpperCase());
  const activeKeyOk = !activeNeedsKey || activeHasKey;

  const summaryHealth = (() => {
    if (!healthSnap) return { label: 'Not tested yet', tone: 'neutral' as const };
    if (!healthForForm) return { label: 'Run check for current fields', tone: 'warn' as const };
    if (healthSnap.lastHealthStatus === 'PASS') return { label: 'Healthy', tone: 'ok' as const };
    return { label: 'Needs attention', tone: 'bad' as const };
  })();

  return (
    <div>
      <PageHeader title="AI Provider" eyebrow="Agency account" />
      <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.9rem', lineHeight: 1.45, maxWidth: '40rem' }}>
        Choose the AI provider and default model used across your agency. Workspace-specific bot instructions stay in each
        client workspace.
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
            style={{ ...mvpButtonStyle, marginTop: '0.5rem' }}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <SectionCard title="Current setup" subtitle="What live assistant replies use for your agency today.">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.85rem' }}>
              <StatusPill label={summaryHealth.label} tone={summaryHealth.tone} />
            </div>
            <KeyValueRows
              rows={[
                { label: 'Provider', value: PROVIDER_LABEL[activeProvider] ?? activeProvider },
                { label: 'Default model', value: activeModel },
                {
                  label: 'API key',
                  value: activeKeyOk ? 'Saved securely' : 'Add a key in Provider setup to enable live replies',
                },
                {
                  label: 'Last health check',
                  value: healthSnap?.lastHealthCheckedAt ? formatDateTime(healthSnap.lastHealthCheckedAt) : '—',
                },
              ]}
            />
          </SectionCard>

          <details style={{ marginBottom: '1rem' }}>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: 650,
                color: 'var(--aisbp-muted, #64748b)',
              }}
            >
              How primary and backup models work
            </summary>
            <p
              style={{
                fontSize: '0.78rem',
                color: 'var(--aisbp-text-secondary, #475569)',
                margin: '0.5rem 0 0',
                lineHeight: 1.45,
                maxWidth: '40rem',
              }}
            >
              Pick which provider is primary for live generation. If a reply fails with a non-OpenAI primary, AISalesBot Pro
              can retry once with OpenAI when a valid OpenAI API key is on file.
            </p>
          </details>

          <SectionCard title="Provider setup" subtitle="Credentials and default model for the provider you are editing below.">
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
                    setSetAsActive(p === activeProvider);
                    const s = snapshotFor(p, providerSnapshots, {
                      defaultModel: p === 'MINIMAX' ? 'MiniMax-M2.7' : 'gpt-4o-mini',
                      maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
                      temperature: PROVIDER_STACK_DEFAULTS.temperature,
                    });
                    const m = getModelFieldForProvider(p, liveAiCatalog);
                    if (m.mode === 'list' && m.options.some(o => o.value === s.defaultModel)) {
                      setDefaultModel(s.defaultModel);
                    } else {
                      setDefaultModel(m.defaultModel);
                    }
                    setEndpointOverride(s.endpoint?.trim() ?? '');
                    if (p === 'MINIMAX') {
                      setMinimaxGroupId(s.minimaxGroupId?.trim() ?? '');
                    } else {
                      setMinimaxGroupId('');
                    }
                  }}
                  style={mvpSelectStyle}
                >
                  {catalogProviderIds(liveAiCatalog).map(p => (
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
                Use as primary for live replies after saving
                {!hasLiveGeneration(selectedProvider) ? (
                  <span style={{ color: 'var(--aisbp-muted, #94a3b8)', fontSize: '0.75rem' }}>— not available</span>
                ) : null}
              </label>

              <label style={mvpLabelStyle}>
                API key
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={hasKeyThis ? 'Leave blank to keep saved key' : 'Paste API key'}
                  autoComplete="new-password"
                  style={mvpInputStyle}
                />
              </label>
              {hasKeyThis ? <p style={mvpFieldHint}>A key is already saved for this provider. It is never shown again.</p> : null}

              {selectedProvider === 'MINIMAX' ? (
                <label style={mvpLabelStyle}>
                  Organization or group ID (optional)
                  <input
                    value={minimaxGroupId}
                    onChange={e => setMinimaxGroupId(e.target.value)}
                    style={mvpInputStyle}
                    placeholder="Optional"
                    autoComplete="off"
                  />
                </label>
              ) : null}

              <label style={mvpLabelStyle}>
                Default model
                <select
                  value={defaultModel}
                  onChange={e => setDefaultModel(e.target.value)}
                  style={mvpSelectStyle}
                >
                  {modelUi.mode === 'list' &&
                    modelUi.options.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => setAdvancedOpen(a => !a)}
                style={{
                  alignSelf: 'flex-start',
                  fontSize: '0.82rem',
                  fontWeight: 650,
                  color: 'var(--aisbp-muted, #64748b)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                {advancedOpen ? 'Hide support settings' : 'Support settings — API base URL (optional)'}
              </button>
              {advancedOpen ? (
                <label style={mvpLabelStyle}>
                  API base URL
                  <input
                    value={endpointOverride}
                    onChange={e => setEndpointOverride(e.target.value)}
                    style={mvpInputStyle}
                    placeholder={defaultEndpointFor(selectedProvider)}
                    autoComplete="off"
                  />
                  <span style={mvpFieldHint}>
                    Leave blank to use the provider default. Change only when your account requires a different API host.
                  </span>
                </label>
              ) : null}

              <p style={mvpFieldHint}>Client-specific persona, goals, and business notes live in each workspace.</p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: saving ? 0.85 : 1 }}
                >
                  {saving ? 'Saving…' : 'Save provider settings'}
                </button>
                <button
                  type="button"
                  disabled={testing || !hasKeyThis}
                  onClick={onTestModel}
                  style={{
                    ...mvpSecondaryButtonStyle,
                    opacity: testing || !hasKeyThis ? 0.65 : 1,
                    cursor: testing || !hasKeyThis ? 'not-allowed' : 'pointer',
                  }}
                >
                  {testing ? 'Testing…' : 'Run health check'}
                </button>
              </div>
              {!hasKeyThis ? <p style={{ ...mvpFieldHint, marginTop: 0 }}>Save an API key before running a health check.</p> : null}
              {testErr ? <ErrorBanner message={testErr} /> : null}
              {testOk ? <SuccessBanner message={testOk} /> : null}
            </form>

            <div
              style={{
                marginTop: '1.25rem',
                paddingTop: '1.1rem',
                borderTop: '1px solid var(--aisbp-border, #e2e8f0)',
              }}
            >
              <p
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  margin: '0 0 0.5rem',
                  color: 'var(--aisbp-text-heading, #0f172a)',
                }}
              >
                Connection health
              </p>
              {!healthSnap ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>No health check recorded yet.</p>
              ) : (
                <>
                  <KeyValueRows
                    rows={[
                      {
                        label: 'Result',
                        value: (
                          <StatusPill
                            label={healthSnap.lastHealthStatus === 'PASS' ? 'Passing' : 'Failing'}
                            tone={healthSnap.lastHealthStatus === 'PASS' ? 'ok' : 'bad'}
                          />
                        ),
                      },
                      { label: 'Checked', value: formatDateTime(healthSnap.lastHealthCheckedAt) },
                      {
                        label: 'Latency',
                        value: healthSnap.lastHealthLatencyMs != null ? `${healthSnap.lastHealthLatencyMs} ms` : '—',
                      },
                      {
                        label: 'Tested',
                        value: `${PROVIDER_LABEL[healthSnap.lastHealthProvider] ?? healthSnap.lastHealthProvider} · ${healthSnap.lastHealthModel}`,
                      },
                      ...(healthSnap.lastHealthStatus === 'FAIL' && healthSnap.lastHealthErrorSummary
                        ? [
                            {
                              label: 'Details',
                              value: (
                                <span style={{ color: 'var(--aisbp-pill-bad-fg, #b91c1c)' }}>
                                  {healthSnap.lastHealthErrorSummary}
                                </span>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                  {!healthForForm ? (
                    <p
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--aisbp-muted, #94a3b8)',
                        margin: '0.65rem 0 0',
                        lineHeight: 1.45,
                      }}
                    >
                      This result matches a different provider or model than selected above — run <strong>Run health check</strong>{' '}
                      to refresh.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Workspace limits"
            subtitle="Choose how much each client workspace can adjust its own model and reply settings."
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
                Allow workspaces to adjust model, reply style, and reply length
              </label>
              <p style={{ ...mvpFieldHint, marginTop: 0 }}>Turn this off to keep all client workspaces on your agency defaults.</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
                <strong>Reply style range</strong> controls how precise or creative workspace replies are allowed to be.
              </p>
              <div style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                <label style={mvpLabelStyle}>
                  Most precise
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
                  Most creative
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
                  Shortest allowed reply
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
                  Longest allowed reply
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
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '-0.1rem 0 0' }}>
                Workspace reply length and style settings must stay within these limits.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={policy.allowResponseStyleOverride}
                  onChange={e => setPolicy(p => ({ ...p, allowResponseStyleOverride: e.target.checked }))}
                />
                Workspaces may change reply style
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={policy.allowMaxTokensOverride}
                  onChange={e => setPolicy(p => ({ ...p, allowMaxTokensOverride: e.target.checked }))}
                />
                Workspaces may change reply length
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={policy.allowModelOverride}
                  onChange={e => setPolicy(p => ({ ...p, allowModelOverride: e.target.checked }))}
                />
                Workspaces may choose a different model
              </label>
              <button
                type="submit"
                disabled={savingPolicy}
                style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: savingPolicy ? 0.85 : 1 }}
              >
                {savingPolicy ? 'Saving…' : 'Save limits'}
              </button>
            </form>
          </SectionCard>
        </>
      )}
    </div>
  );
}
