'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface ActionIntent {
  id: string;
  action_type: string;
  source: string;
  status: string;
  params: Record<string, unknown>;
  reason: string | null;
  gating_note: string | null;
  executed_at: string | null;
  created_at: string;
  conversation_id: string | null;
}

export default function ActionIntentsPage() {
  const { token, loading: authLoading } = useAuth();

  const [tenantId, setTenantId] = useState<string>('');
  const [intents, setIntents] = useState<ActionIntent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const loadIntents = async (tid: string, status?: string, pageNum: number = 1) => {
    if (!token || !tid) return;
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ tenantId: tid, page: String(pageNum), limit: String(pageSize) });
      if (status) params.set('status', status);
      const res = await fetch(`/api/v1/action-intents?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load action intents');
      const data = await res.json();
      setIntents(data.intents ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) loadIntents(tenantId, statusFilter, page);
  }, [page]);

  const handleLoad = () => {
    setPage(1);
    loadIntents(tenantId, statusFilter, 1);
  };

  const formatTime = (iso: string) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      SUGGESTED: '#e9ecef',
      DEFERRED: '#fff3cd',
      BLOCKED: '#f8d7da',
      ALLOWED: '#d4edda',
      EXECUTED: '#d4edda',
      FAILED: '#f8d7da',
    };
    return (
      <span style={{
        padding: '0.2rem 0.5rem',
        borderRadius: '4px',
        backgroundColor: colors[status] || '#e9ecef',
        color: '#333',
        fontSize: '0.8rem',
        fontWeight: 'bold',
      }}>
        {status}
      </span>
    );
  };

  if (authLoading) return <div style={{ padding: '2rem' }}>Loading...</div>;

  const totalPages = Math.ceil(total / pageSize);

  return (
    <main style={{ padding: '2rem' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Action Intents</h1>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Subaccount ID"
          value={tenantId}
          onChange={e => setTenantId(e.target.value)}
          style={{ padding: '0.5rem', fontSize: '0.875rem', width: '240px' }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '0.5rem', fontSize: '0.875rem' }}
        >
          <option value="">All statuses</option>
          <option value="SUGGESTED">Suggested</option>
          <option value="DEFERRED">Deferred</option>
          <option value="BLOCKED">Blocked</option>
          <option value="EXECUTED">Executed</option>
          <option value="FAILED">Failed</option>
        </select>
        <button
          onClick={handleLoad}
          disabled={!tenantId || loading}
          style={{ padding: '0.5rem 1rem', cursor: tenantId ? 'pointer' : 'not-allowed', opacity: tenantId ? 1 : 0.5 }}
        >
          {loading ? 'Loading...' : 'Load'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: '#f8d7da', color: '#721c24', marginBottom: '1rem', borderRadius: '4px' }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: '#666' }}>
        {tenantId ? `${total} total intent${total !== 1 ? 's' : ''}` : 'Enter a subaccount ID to load action intents'}
      </div>

      {intents.length > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem' }}>Type</th>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Source</th>
                <th style={{ padding: '0.5rem' }}>Reason</th>
                <th style={{ padding: '0.5rem' }}>Gating Note</th>
                <th style={{ padding: '0.5rem' }}>Conversation</th>
                <th style={{ padding: '0.5rem' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {intents.map(intent => (
                <tr key={intent.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'inherit', fontSize: '0.8rem' }}>
                    {intent.action_type}
                  </td>
                  <td style={{ padding: '0.5rem' }}>{getStatusBadge(intent.status)}</td>
                  <td style={{ padding: '0.5rem' }}>{intent.source}</td>
                  <td style={{ padding: '0.5rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {intent.reason || '—'}
                  </td>
                  <td style={{ padding: '0.5rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {intent.gating_note || '—'}
                  </td>
                  <td style={{ padding: '0.5rem', fontFamily: 'inherit', fontSize: '0.75rem' }}>
                    {intent.conversation_id ? `${intent.conversation_id.slice(0, 8)}...` : '—'}
                  </td>
                  <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{formatTime(intent.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ padding: '0.3rem 0.75rem', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.875rem', color: '#666' }}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{ padding: '0.3rem 0.75rem', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
