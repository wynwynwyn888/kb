'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../contexts/AuthContext';
import { getGhlConnection, saveGhlConnection, verifyGhlConnection, checkGhlHealth, deleteGhlConnection, GhlConnectionStatus } from '../../../../lib/api';

export default function TenantSettingsPage() {
  const params = useParams();
  const tenantId = params.id as string;
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();

  const [connection, setConnection] = useState<GhlConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [ghlLocationId, setGhlLocationId] = useState('');
  const [privateIntegrationToken, setPrivateIntegrationToken] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace('/login');
      return;
    }
    if (token && tenantId) {
      loadConnection();
    }
  }, [token, tenantId, authLoading]);

  const loadConnection = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const status = await getGhlConnection(token, tenantId);
      setConnection(status);
      if (status.ghlLocationId) {
        setGhlLocationId(status.ghlLocationId);
      }
    } catch (err) {
      setError('Failed to load connection status');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await saveGhlConnection(token, tenantId, {
        ghlLocationId,
        privateIntegrationToken,
      });

      if (result.success) {
        setSuccess('Connected successfully!');
        setPrivateIntegrationToken('');
        await loadConnection();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!token) return;
    setError('');
    setSuccess('');

    try {
      const result = await verifyGhlConnection(token, tenantId);
      setConnection(result);
      setSuccess('Verification complete');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const handleHealthCheck = async () => {
    if (!token) return;
    setError('');
    setSuccess('');

    try {
      const health = await checkGhlHealth(token, tenantId);
      setSuccess(health.message);
      await loadConnection();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    }
  };

  const handleDisconnect = async () => {
    if (!token) return;
    if (!confirm('Are you sure you want to disconnect?')) return;

    try {
      await deleteGhlConnection(token, tenantId);
      setSuccess('Disconnected successfully');
      setGhlLocationId('');
      setPrivateIntegrationToken('');
      await loadConnection();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CONNECTED: '#d4edda',
      DISCONNECTED: '#e9ecef',
      INVALID: '#f8d7da',
      ERROR: '#f8d7da',
    };
    return (
      <span style={{
        padding: '0.25rem 0.75rem',
        borderRadius: '4px',
        backgroundColor: colors[status] || '#e9ecef',
        color: '#333',
        fontSize: '0.875rem',
        fontWeight: 'bold',
      }}>
        {status}
      </span>
    );
  };

  if (authLoading || loading) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '800px' }}>
      <h1>GHL Connection Settings</h1>

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

      {/* Current Connection Status */}
      <div style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>Connection Status</h3>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.875rem', color: '#666' }}>Status:</span>
          {getStatusBadge(connection?.status || 'DISCONNECTED')}
        </div>

        {connection?.connected && (
          <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '1rem' }}>
            <p style={{ margin: '0.25rem 0' }}><strong>Location ID:</strong> {connection.ghlLocationId}</p>
            <p style={{ margin: '0.25rem 0' }}><strong>Verified:</strong> {connection.verifiedAt ? new Date(connection.verifiedAt).toLocaleString() : 'Never'}</p>
            <p style={{ margin: '0.25rem 0' }}><strong>Last Health Check:</strong> {connection.lastHealthCheckAt ? new Date(connection.lastHealthCheckAt).toLocaleString() : 'Never'}</p>
          </div>
        )}

        {!connection?.connected && (
          <p style={{ color: '#666' }}>Not connected to GHL.</p>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleVerify}
            disabled={!connection?.connected}
            style={{ padding: '0.5rem 1rem', cursor: connection?.connected ? 'pointer' : 'not-allowed', opacity: connection?.connected ? 1 : 0.5 }}
          >
            Verify
          </button>
          <button
            onClick={handleHealthCheck}
            disabled={!connection?.connected}
            style={{ padding: '0.5rem 1rem', cursor: connection?.connected ? 'pointer' : 'not-allowed', opacity: connection?.connected ? 1 : 0.5 }}
          >
            Health Check
          </button>
          {connection?.connected && (
            <button
              onClick={handleDisconnect}
              style={{ padding: '0.5rem 1rem', backgroundColor: '#dc3545', color: 'white', border: 'none', cursor: 'pointer' }}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Connect/Update Form */}
      <div style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>
          {connection?.connected ? 'Update Connection' : 'Connect to GHL'}
        </h3>

        <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              GHL Location ID
            </label>
            <input
              type="text"
              value={ghlLocationId}
              onChange={(e) => setGhlLocationId(e.target.value)}
              required
              style={{ width: '100%', padding: '0.75rem', fontSize: '1rem' }}
              placeholder="Enter your GHL location ID"
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Private Integration Token
            </label>
            <input
              type="password"
              value={privateIntegrationToken}
              onChange={(e) => setPrivateIntegrationToken(e.target.value)}
              required={!connection?.connected}
              style={{ width: '100%', padding: '0.75rem', fontSize: '1rem' }}
              placeholder="Enter your GHL private integration token"
            />
            <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
              Get this from your GHL account → Settings → Integrations → Private Integrations
            </p>
          </div>

          <button
            type="submit"
            disabled={saving || !ghlLocationId || !privateIntegrationToken}
            style={{
              padding: '0.75rem',
              fontSize: '1rem',
              backgroundColor: saving ? '#ccc' : '#0070f3',
              color: 'white',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Connecting...' : connection?.connected ? 'Update Connection' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}