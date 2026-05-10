'use client';

import type { CSSProperties } from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAgencyAiConfig,
  postAgencyAiModelHealthTest,
  saveAgencyAiConfig,
  setActiveAiProvider,
  type AgencyProviderSnapshot,
  type AiModelHealthSnapshot,
  type AgencyAiConfig,
} from '@/lib/api';
import type { LiveAiCatalogDto } from '@/lib/api';
import { getModelFieldForProvider, PROVIDER_LABEL } from '@/lib/ai-model-options';
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
  mvpFieldHint,
  mvpInputStyle,
  mvpLabelStyle,
  mvpPrimaryButtonStyle,
  mvpSecondaryButtonStyle,
  mvpSelectStyle,
} from '@/components/app/mvp-ui';

const PROVIDER_STACK_DEFAULTS = { temperature: 0.7, maxTokens: 800 };

const LIVE_PROVIDERS = ['OPENAI', 'MINIMAX'] as const;
type LiveProviderId = (typeof LIVE_PROVIDERS)[number];

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

const cardShell: CSSProperties = {
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  borderRadius: 12,
  padding: '1rem 1.1rem',
  background: 'var(--aisbp-surface, #fff)',
  color: 'var(--aisbp-text, #0f172a)',
};

const warnBanner: CSSProperties = {
  marginBottom: '0.85rem',
  padding: '0.65rem 0.85rem',
  borderRadius: 8,
  border: '1px solid var(--aisbp-pill-warn-border, #fde68a)',
  background: 'var(--aisbp-pill-warn-bg, #fffbeb)',
  color: 'var(--aisbp-pill-warn-fg, #b45309)',
  fontSize: '0.84rem',
  lineHeight: 1.45,
};

export default function AgencyAiSettingsPage() {
  const { token } = useAuth();
  const [loadKey, setLoadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bootstrapErr, setBootstrapErr] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [activeProvider, setActiveProvider] = useState('OPENAI');
  const [activeModel, setActiveModel] = useState('gpt-4o-mini');
  const [keysPresent, setKeysPresent] = useState<Partial<Record<string, boolean>>>({});
  const [providerSnapshots, setProviderSnapshots] = useState<
    Partial<Record<string, AgencyProviderSnapshot>> | undefined
  >();
  const [healthSnap, setHealthSnap] = useState<AiModelHealthSnapshot | null>(null);
  const [liveAiCatalog, setLiveAiCatalog] = useState<LiveAiCatalogDto | null>(null);
  const [activeAiHealth, setActiveAiHealth] = useState<AgencyAiConfig['activeAiHealth'] | null>(null);

  const [editingProvider, setEditingProvider] = useState<LiveProviderId | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [endpointOverride, setEndpointOverride] = useState('');
  const [minimaxGroupId, setMinimaxGroupId] = useState('');
  const [supportOpen, setSupportOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testingTarget, setTestingTarget] = useState<'active' | LiveProviderId | null>(null);

  const snapshotDefaultModel = useCallback(
    (p: LiveProviderId): string => {
      const s = snapshotFor(p, providerSnapshots, {
        defaultModel: p === 'MINIMAX' ? 'MiniMax-M2.7' : 'gpt-4o-mini',
        maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
        temperature: PROVIDER_STACK_DEFAULTS.temperature,
      });
      const m = getModelFieldForProvider(p, liveAiCatalog);
      if (m.mode === 'list' && m.options.some(o => o.value === s.defaultModel)) {
        return s.defaultModel;
      }
      return m.defaultModel;
    },
    [providerSnapshots, liveAiCatalog],
  );

  const modelUiForEdit = useMemo(
    () => (editingProvider ? getModelFieldForProvider(editingProvider, liveAiCatalog) : null),
    [editingProvider, liveAiCatalog],
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
        const ap = (c.activeProvider ?? c.provider).toUpperCase();
        setActiveProvider(ap);
        setActiveModel(c.activeModel ?? c.defaultModel);
        setKeysPresent(c.keysPresent ?? {});
        setProviderSnapshots(c.providerSnapshots);
        setHealthSnap(c.aiModelHealthSnapshot ?? null);
        setLiveAiCatalog(c.liveAiCatalog ?? null);
        setActiveAiHealth(c.activeAiHealth);
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

  useEffect(() => {
    if (!editingProvider) return;
    const s = snapshotFor(editingProvider, providerSnapshots, {
      defaultModel: editingProvider === 'MINIMAX' ? 'MiniMax-M2.7' : 'gpt-4o-mini',
      maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
      temperature: PROVIDER_STACK_DEFAULTS.temperature,
    });
    const m = getModelFieldForProvider(editingProvider, liveAiCatalog);
    if (m.mode === 'list' && m.options.some(o => o.value === s.defaultModel)) {
      setDefaultModel(s.defaultModel);
    } else {
      setDefaultModel(m.defaultModel);
    }
    setApiKey('');
    setEndpointOverride(s.endpoint?.trim() ?? '');
    setMinimaxGroupId(editingProvider === 'MINIMAX' ? (s.minimaxGroupId?.trim() ?? '') : '');
    setSupportOpen(false);
  }, [editingProvider, providerSnapshots, liveAiCatalog]);

  const activeKeyOk = Boolean(keysPresent[activeProvider]);
  const activeHealthLabel = useMemo(() => {
    if (!activeAiHealth) return { label: 'Not tested', tone: 'neutral' as const };
    if (activeAiHealth.healthBadge === 'PASS') return { label: 'Healthy', tone: 'ok' as const };
    if (activeAiHealth.healthBadge === 'FAIL') return { label: 'Needs attention', tone: 'bad' as const };
    return { label: 'Not tested', tone: 'neutral' as const };
  }, [activeAiHealth]);

  const refreshConfig = async () => {
    if (!token) return;
    const c = await getAgencyAiConfig(token);
    setActiveProvider((c.activeProvider ?? c.provider).toUpperCase());
    setActiveModel(c.activeModel ?? c.defaultModel);
    setKeysPresent(c.keysPresent ?? {});
    setProviderSnapshots(c.providerSnapshots);
    setHealthSnap(c.aiModelHealthSnapshot ?? null);
    setLiveAiCatalog(c.liveAiCatalog ?? null);
    setActiveAiHealth(c.activeAiHealth);
  };

  const runHealthCheck = async (target: 'active' | LiveProviderId) => {
    if (!token) return;
    setErr('');
    setOk('');
    setTestingTarget(target);
    try {
      let provider: string;
      let model: string;
      if (target === 'active') {
        provider = activeProvider;
        model = activeModel;
      } else {
        provider = target;
        model = snapshotDefaultModel(target);
      }
      const r = await postAgencyAiModelHealthTest(token, {
        provider,
        model,
        optionalUseSavedKey: true,
      });
      await refreshConfig();
      if (r.status === 'PASS') {
        const human =
          provider === 'MINIMAX'
            ? 'MiniMax connection healthy.'
            : 'OpenAI connection healthy.';
        setOk(`${human} (${r.latencyMs} ms)`);
      } else {
        setErr(r.errorSummary || 'Health check failed.');
      }
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Test failed');
    } finally {
      setTestingTarget(null);
    }
  };

  const onSaveEditing = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !editingProvider) return;
    if (editingProvider === 'MINIMAX' && !apiKey.trim() && !keysPresent['MINIMAX']) {
      setErr('MiniMax needs an API key. Paste your key to save.');
      return;
    }
    setErr('');
    setOk('');
    setSaving(true);
    try {
      const baseDefault = defaultEndpointFor(editingProvider);
      const ep = endpointOverride.trim();
      const payload: Parameters<typeof saveAgencyAiConfig>[1] = {
        provider: editingProvider,
        apiKey: apiKey.trim() || undefined,
        defaultModel,
        temperature: PROVIDER_STACK_DEFAULTS.temperature,
        maxTokens: PROVIDER_STACK_DEFAULTS.maxTokens,
        setAsActive: false,
      };
      if (supportOpen) {
        if (ep && ep !== baseDefault) {
          payload.endpoint = ep;
        } else if (!ep) {
          payload.endpoint = '';
        }
      }
      if (editingProvider === 'MINIMAX' && supportOpen) {
        payload.minimaxGroupId = minimaxGroupId.trim();
      }

      await saveAgencyAiConfig(token, payload);
      setOk(`Saved ${PROVIDER_LABEL[editingProvider] ?? editingProvider} settings.`);
      setApiKey('');
      await refreshConfig();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const setActiveWithGuard = async (provider: LiveProviderId) => {
    if (!token) return;
    const model = snapshotDefaultModel(provider);
    const applies = healthAppliesToSelection(healthSnap, provider, model);
    const unhealthy = applies && healthSnap?.lastHealthStatus === 'FAIL';
    if (unhealthy) {
      const okConfirm = window.confirm(
        'This provider is not healthy. Live replies may fail. Set it as active anyway?',
      );
      if (!okConfirm) return;
    }
    setErr('');
    setOk('');
    try {
      await setActiveAiProvider(token, provider);
      setOk(`Active provider is now ${PROVIDER_LABEL[provider] ?? provider}.`);
      await refreshConfig();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Could not change active provider');
    }
  };

  const providerCardHealth = (p: LiveProviderId) => {
    const m = snapshotDefaultModel(p);
    if (!healthSnap || !healthAppliesToSelection(healthSnap, p, m)) {
      return { label: 'Not tested', tone: 'neutral' as const };
    }
    if (healthSnap.lastHealthStatus === 'PASS') return { label: 'Healthy', tone: 'ok' as const };
    return { label: 'Needs attention', tone: 'bad' as const };
  };

  const canSetActive = (p: LiveProviderId) => hasLiveGeneration(p) && Boolean(keysPresent[p]);

  return (
    <div>
      <PageHeader title="AI Provider" eyebrow="Agency account" />
      <p
        style={{
          fontSize: '0.84rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 0.9rem',
          lineHeight: 1.45,
          maxWidth: '44rem',
        }}
      >
        Choose the AI providers and default model used for agency-managed replies.
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
              padding: '0.5rem 0.9rem',
              borderRadius: 8,
              border: '1px solid var(--aisbp-border-strong, #cbd5e1)',
              background: 'var(--aisbp-surface, #fff)',
              cursor: 'pointer',
              fontSize: '0.88rem',
              fontWeight: 650,
              color: 'var(--aisbp-text-secondary, #334155)',
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {err ? <ErrorBanner message={err} /> : null}
          {ok ? <SuccessBanner message={ok} /> : null}

          <SectionCard title="Current active provider" subtitle="Used for live assistant replies for workspaces under this agency.">
            {activeAiHealth?.healthBadge === 'FAIL' ? (
              <div role="alert" style={warnBanner}>
                Current provider needs attention before it should be used for live replies.
              </div>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
              <StatusPill label={activeHealthLabel.label} tone={activeHealthLabel.tone} />
            </div>
            <KeyValueRows
              rows={[
                { label: 'Provider', value: PROVIDER_LABEL[activeProvider] ?? activeProvider },
                { label: 'Model', value: activeModel },
                {
                  label: 'API key',
                  value: activeKeyOk ? 'Saved securely' : 'Missing',
                },
                {
                  label: 'Last checked',
                  value:
                    activeAiHealth?.lastHealthCheckedAt != null
                      ? formatDateTime(activeAiHealth.lastHealthCheckedAt)
                      : '—',
                },
              ]}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button
                type="button"
                disabled={!activeKeyOk || testingTarget !== null}
                onClick={() => runHealthCheck('active')}
                style={{
                  ...mvpPrimaryButtonStyle,
                  opacity: !activeKeyOk || testingTarget !== null ? 0.65 : 1,
                  cursor: !activeKeyOk || testingTarget !== null ? 'not-allowed' : 'pointer',
                }}
              >
                {testingTarget === 'active' ? 'Running…' : 'Run health check'}
              </button>
              <a
                href="#saved-configurations"
                style={{
                  ...mvpSecondaryButtonStyle,
                  display: 'inline-block',
                  textDecoration: 'none',
                  textAlign: 'center',
                }}
              >
                Change active provider
              </a>
            </div>
            {!activeKeyOk ? (
              <p style={{ ...mvpFieldHint, marginTop: '0.65rem' }}>
                Save an API key for this provider in Saved configurations before running a health check.
              </p>
            ) : null}
          </SectionCard>

          <h2
            id="saved-configurations"
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              margin: '1.25rem 0 0.65rem',
              color: 'var(--aisbp-text-heading, #0f172a)',
            }}
          >
            Saved configurations
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.85rem', maxWidth: '44rem' }}>
            Each provider stores its own API key and default model. Use <strong>Set as active</strong> to switch the live
            provider.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            {LIVE_PROVIDERS.map(p => {
              const dm = snapshotDefaultModel(p);
              const h = providerCardHealth(p);
              const isActive = activeProvider.toUpperCase() === p;
              const hasKey = Boolean(keysPresent[p]);
              const ph = healthAppliesToSelection(healthSnap, p, dm);
              const failActive = isActive && ph && healthSnap?.lastHealthStatus === 'FAIL';

              return (
                <div key={p} style={cardShell}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <strong style={{ fontSize: '0.95rem', color: 'var(--aisbp-text-heading)' }}>
                      {PROVIDER_LABEL[p] ?? p}
                    </strong>
                    <StatusPill label={isActive ? 'Active' : 'Not active'} tone={isActive ? 'ok' : 'neutral'} />
                  </div>
                  <dl style={{ margin: '0.65rem 0', fontSize: '0.84rem', color: 'var(--aisbp-text-secondary, #334155)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <dt style={{ color: 'var(--aisbp-muted)' }}>API key</dt>
                      <dd style={{ margin: 0, fontWeight: 600 }}>{hasKey ? 'Saved securely' : 'Missing'}</dd>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.35rem' }}>
                      <dt style={{ color: 'var(--aisbp-muted)' }}>Default model</dt>
                      <dd style={{ margin: 0 }}>{dm}</dd>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginTop: '0.35rem',
                      }}
                    >
                      <dt style={{ color: 'var(--aisbp-muted)' }}>Health</dt>
                      <dd style={{ margin: 0 }}>
                        <StatusPill label={h.label} tone={h.tone} />
                      </dd>
                    </div>
                  </dl>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setEditingProvider(editingProvider === p ? null : p)}
                      style={{ ...mvpSecondaryButtonStyle, padding: '0.35rem 0.65rem', fontSize: '0.82rem' }}
                    >
                      {editingProvider === p ? 'Close' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      disabled={!hasKey || testingTarget !== null}
                      onClick={() => runHealthCheck(p)}
                      style={{
                        ...mvpSecondaryButtonStyle,
                        padding: '0.35rem 0.65rem',
                        fontSize: '0.82rem',
                        opacity: !hasKey || testingTarget !== null ? 0.65 : 1,
                      }}
                    >
                      {testingTarget === p ? 'Running…' : 'Run health check'}
                    </button>
                    <button
                      type="button"
                      disabled={!canSetActive(p) || testingTarget !== null}
                      title={!hasKey ? 'Save an API key first' : undefined}
                      onClick={() => setActiveWithGuard(p)}
                      style={{
                        ...mvpPrimaryButtonStyle,
                        padding: '0.35rem 0.65rem',
                        fontSize: '0.82rem',
                        opacity: !canSetActive(p) || testingTarget !== null ? 0.65 : 1,
                      }}
                    >
                      Set as active
                    </button>
                  </div>
                  {failActive ? (
                    <p style={{ ...mvpFieldHint, marginTop: '0.55rem', marginBottom: 0 }}>
                      Health check failed for this configuration. Fix credentials or run health check before relying on live
                      replies.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {editingProvider ? (
            <SectionCard
              title={`Edit ${PROVIDER_LABEL[editingProvider] ?? editingProvider}`}
              subtitle="API key is stored securely and never shown again after saving."
            >
              <form onSubmit={onSaveEditing} style={{ maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <label style={mvpLabelStyle}>
                  API key
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={keysPresent[editingProvider] ? 'Leave blank to keep saved key' : 'Paste API key'}
                    autoComplete="new-password"
                    style={mvpInputStyle}
                  />
                </label>
                {keysPresent[editingProvider] ? (
                  <p style={mvpFieldHint}>A key is already saved. Leave blank to keep it.</p>
                ) : null}

                <label style={mvpLabelStyle}>
                  Default model
                  <select
                    value={defaultModel}
                    onChange={e => setDefaultModel(e.target.value)}
                    style={mvpSelectStyle}
                  >
                    {modelUiForEdit?.mode === 'list' &&
                      modelUiForEdit.options.map(o => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => setSupportOpen(s => !s)}
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
                  {supportOpen ? 'Hide support settings' : 'Support settings'}
                </button>
                {supportOpen ? (
                  <>
                    <label style={mvpLabelStyle}>
                      API base URL
                      <input
                        value={endpointOverride}
                        onChange={e => setEndpointOverride(e.target.value)}
                        style={mvpInputStyle}
                        placeholder={defaultEndpointFor(editingProvider)}
                        autoComplete="off"
                      />
                      <span style={mvpFieldHint}>
                        Leave blank for the default endpoint. Change only when your account requires a different API host.
                      </span>
                    </label>
                    {editingProvider === 'MINIMAX' ? (
                      <label style={mvpLabelStyle}>
                        Organization / group ID (optional)
                        <input
                          value={minimaxGroupId}
                          onChange={e => setMinimaxGroupId(e.target.value)}
                          style={mvpInputStyle}
                          placeholder="Only if your MiniMax account requires it"
                          autoComplete="off"
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}

                <button type="submit" disabled={saving} style={{ ...mvpPrimaryButtonStyle, width: 'fit-content', opacity: saving ? 0.85 : 1 }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </form>
            </SectionCard>
          ) : null}
        </>
      )}
    </div>
  );
}
