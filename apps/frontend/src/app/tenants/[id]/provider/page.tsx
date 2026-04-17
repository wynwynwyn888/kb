'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../contexts/AuthContext';

interface AgencyAiConfig {
  provider: string;
  enabled: boolean;
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
  hasApiKey: boolean;
}

export default function TenantProviderPage() {
  const params = useParams();
  const tenantId = params.id as string;
  const { token, loading: authLoading, user } = useAuth();
  const router = useRouter();

  const [config, setConfig] = useState<AgencyAiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [provider, setProvider] = useState('OPENAI');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [temperature, setTemperature] = useState('0.7');
  const [maxTokens, setMaxTokens] = useState('500');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace('/login');
      return;
    }
    if (token && user?.agencyId) {
      loadConfig();
    }
  }, [token, authLoading, user, tenantId]);

  const loadConfig = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await fetch('/api/v1/agency-ai-config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load config');
      const data = await res.json();
      setConfig(data);
      setProvider(data.provider || 'OPENAI');
      setDefaultModel(data.defaultModel || 'gpt-4o-mini');
      setTemperature(String(data.temperature ?? 0.7));
      setMaxTokens(String(data.maxTokens ?? 500));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/v1/agency-ai-config', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider,
          apiKey: apiKey || undefined,
          defaultModel,
          temperature: parseFloat(temperature),
          maxTokens: parseInt(maxTokens),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to save');
      }

      setSuccess('Provider config saved');
      setApiKey(''); // Clear after save
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (config: AgencyAiConfig) => {
    const enabled = config.enabled && config.hasApiKey;
    return (
      <span style={{
        padding: '0.25rem 0.75rem',
        borderRadius: '4px',
        backgroundColor: enabled ? '#d4edda' : '#e9ecef',
        color: enabled ? '#155724' : '#666',
        fontSize: '0.875rem',
        fontWeight: 'bold',
      }}>
        {enabled ? 'Configured' : 'Not configured'}
      </span>
    );
  };

  if (authLoading || loading) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '800px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={() => router.back()}
          style={{ padding: '0.3rem 0.75rem', marginBottom: '0.5rem', cursor: 'pointer' }}
        >
          ← Back
        </button>
        <h1 style={{ margin: 0 }}>AI Provider Settings</h1>
        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: '#666' }}>
          Tenant: {tenantId} · Agency: {user?.agencyId || '—'}
        </p>
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: '#f8d7da', color: '#721c24', marginBottom: '1rem', borderRadius: '4px' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: '1rem', backgroundColor: '#d4edda', color: '#155724', marginBottom: '1rem', borderRadius: '4px' }}>
          {success}
        </div>
      )}

      {/* Current status */}
      {config && (
        <div style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0 }}>Current Status</h3>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {getStatusBadge(config)}
            <span style={{ fontSize: '0.875rem', color: '#666' }}>
              Provider: <strong>{config.provider}</strong> · Model: <strong>{config.defaultModel}</strong>
              {config.temperature !== undefined && ` · Temperature: ${config.temperature}`}
              {config.maxTokens !== undefined && ` · Max tokens: ${config.maxTokens}`}
            </span>
          </div>
          {!config.hasApiKey && (
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#856404', backgroundColor: '#fff3cd', padding: '0.5rem', borderRadius: '4px' }}>
              No API key configured. Live AI generation will not work until a key is provided.
            </p>
          )}
        </div>
      )}

      {/* Config form */}
      <div style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>Configure AI Provider</h3>
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
              Provider
            </label>
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', fontSize: '0.875rem' }}
            >
              <option value="OPENAI">OpenAI</option>
              <option value="ANTHROPIC" disabled>Anthropic (coming soon)</option>
              <option value="GOOGLE" disabled>Google (coming soon)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={config?.hasApiKey ? '•••••••• (leave empty to keep existing)' : 'Enter API key'}
              autoComplete="off"
              style={{ width: '100%', padding: '0.75rem', fontSize: '0.875rem' }}
            />
            {config?.hasApiKey && (
              <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                Leave empty to keep your existing API key.
              </p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
              Default Model
            </label>
            <select
              value={defaultModel}
              onChange={e => setDefaultModel(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', fontSize: '0.875rem' }}
            >
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
                Temperature (0–1)
              </label>
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={e => setTemperature(e.target.value)}
                style={{ width: '100%', padding: '0.75rem', fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
                Max Tokens
              </label>
              <input
                type="number"
                min="100"
                max="4000"
                step="100"
                value={maxTokens}
                onChange={e => setMaxTokens(e.target.value)}
                style={{ width: '100%', padding: '0.75rem', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '0.75rem',
              fontSize: '1rem',
              backgroundColor: saving ? '#ccc' : '#0070f3',
              color: 'white',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </form>
      </div>
    </div>
  );
}
