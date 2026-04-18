'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import * as api from '../../lib/api';

interface TenantSummary {
  id: string;
  name: string;
  ghlLocationId: string;
  status: string;
}

interface TenantDetail {
  id: string;
  name: string;
  ghlLocationId: string;
  status: string;
  agencyId: string;
  promptConfig?: {
    id: string;
    name: string;
    temperature: number;
    modelOverride?: string;
  } | null;
  quota?: {
    totalQuota: number;
    usedQuota: number;
    remainingQuota: number;
    periodStart: string;
    periodEnd: string;
  } | null;
}

export default function DashboardPage() {
  const { user, token, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (token && user?.agencyId) {
      loadTenants();
    } else if (token && user?.tenantId) {
      // Tenant user - load their tenant directly
      loadTenantDetail(user.tenantId);
    }
  }, [token, user?.agencyId, user?.tenantId]);

  const loadTenants = async () => {
    if (!token || !user?.agencyId) return;

    try {
      setLoading(true);
      const data = await api.getTenantsByAgency(token, user.agencyId);
      setTenants(data);
      if (data.length > 0 && data[0]) {
        loadTenantDetail(data[0].id);
      }
    } catch (err) {
      setError('Failed to load tenants');
    } finally {
      setLoading(false);
    }
  };

  const loadTenantDetail = async (tenantId: string) => {
    if (!token) return;

    try {
      const data = await api.getTenantById(token, tenantId);
      setSelectedTenant(data);
    } catch (err) {
      setError('Failed to load tenant details');
    }
  };

  const handleTenantChange = async (tenantId: string) => {
    setSelectedTenant(null);
    await loadTenantDetail(tenantId);
  };

  if (authLoading || loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <header style={{ padding: '1rem 2rem', borderBottom: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>AI SaaS Platform</h1>
          <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.875rem' }}>
            Logged in as: {user.email}
          </p>
        </div>
        <button onClick={logout} style={{ padding: '0.5rem 1rem' }}>Logout</button>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '2rem' }}>
        <h2 style={{ marginTop: 0 }}>Dashboard</h2>

        {error && (
          <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>
        )}

        {/* Tenant Selector (for agency users) */}
        {user.agencyId && tenants.length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Select Tenant:
            </label>
            <select
              value={selectedTenant?.id || ''}
              onChange={(e) => handleTenantChange(e.target.value)}
              style={{ padding: '0.5rem', minWidth: '300px', fontSize: '1rem' }}
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {selectedTenant && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
            {/* Tenant Info Card */}
            <div style={{ border: '1px solid #ccc', padding: '1.5rem', borderRadius: '8px' }}>
              <h3 style={{ marginTop: 0 }}>{selectedTenant.name}</h3>
              <dl style={{ margin: 0 }}>
                <dt style={{ color: '#666', fontSize: '0.875rem' }}>GHL Location ID</dt>
                <dd style={{ margin: '0.25rem 0 1rem' }}>{selectedTenant.ghlLocationId}</dd>
                <dt style={{ color: '#666', fontSize: '0.875rem' }}>Status</dt>
                <dd style={{ margin: '0.25rem 0' }}>
                  <span style={{
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    backgroundColor: selectedTenant.status === 'active' ? '#d4edda' : '#fff3cd',
                  }}>
                    {selectedTenant.status}
                  </span>
                </dd>
              </dl>
              <a
                href={`/tenants/${selectedTenant.id}/settings`}
                style={{
                  display: 'inline-block',
                  marginTop: '1rem',
                  padding: '0.5rem 1rem',
                  backgroundColor: '#0070f3',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                }}
              >
                GHL Settings
              </a>
            </div>

            {/* Prompt Config Card */}
            <div style={{ border: '1px solid #ccc', padding: '1.5rem', borderRadius: '8px' }}>
              <h3 style={{ marginTop: 0 }}>Prompt Configuration</h3>
              {selectedTenant.promptConfig ? (
                <dl style={{ margin: 0 }}>
                  <dt style={{ color: '#666', fontSize: '0.875rem' }}>Active Config</dt>
                  <dd style={{ margin: '0.25rem 0 1rem' }}>{selectedTenant.promptConfig.name}</dd>
                  <dt style={{ color: '#666', fontSize: '0.875rem' }}>Temperature</dt>
                  <dd style={{ margin: '0.25rem 0 1rem' }}>{selectedTenant.promptConfig.temperature}</dd>
                  {selectedTenant.promptConfig.modelOverride && (
                    <>
                      <dt style={{ color: '#666', fontSize: '0.875rem' }}>Model Override</dt>
                      <dd style={{ margin: '0.25rem 0' }}>{selectedTenant.promptConfig.modelOverride}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <p style={{ color: '#666' }}>No active prompt configuration</p>
              )}
            </div>

            {/* Quota Card */}
            <div style={{ border: '1px solid #ccc', padding: '1.5rem', borderRadius: '8px' }}>
              <h3 style={{ marginTop: 0 }}>Quota Status</h3>
              {selectedTenant.quota ? (
                <>
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{
                      height: '8px',
                      backgroundColor: '#e9ecef',
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${(selectedTenant.quota.usedQuota / selectedTenant.quota.totalQuota) * 100}%`,
                        backgroundColor: selectedTenant.quota.usedQuota > selectedTenant.quota.totalQuota * 0.8 ? '#dc3545' : '#28a745',
                      }} />
                    </div>
                  </div>
                  <dl style={{ margin: 0 }}>
                    <dt style={{ color: '#666', fontSize: '0.875rem' }}>Used / Total</dt>
                    <dd style={{ margin: '0.25rem 0 0.5rem', fontSize: '1.25rem', fontWeight: 'bold' }}>
                      {selectedTenant.quota.usedQuota.toLocaleString()} / {selectedTenant.quota.totalQuota.toLocaleString()}
                    </dd>
                    <dt style={{ color: '#666', fontSize: '0.875rem' }}>Remaining</dt>
                    <dd style={{ margin: '0.25rem 0' }}>{selectedTenant.quota.remainingQuota.toLocaleString()}</dd>
                  </dl>
                </>
              ) : (
                <p style={{ color: '#666' }}>No quota configured</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}