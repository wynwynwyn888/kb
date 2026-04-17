'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface ActiveHandover {
  conversationId: string;
  ghlConversationId: string;
  contactId: string;
  channel: string;
  handoverId: string;
  handoverType: string;
  initiatedBy: string;
  note: string | null;
  createdAt: string;
}

export default function HandoverQueuePage() {
  const { token, loading: authLoading } = useAuth();

  const [tenantId, setTenantId] = useState<string>('');
  const [handovers, setHandovers] = useState<ActiveHandover[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resuming, setResuming] = useState<string | null>(null);

  const loadActiveHandovers = async (tid: string) => {
    if (!token || !tid) return;
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/v1/handover/active?tenantId=${tid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load handover queue');
      const data = await res.json();
      setHandovers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async (conversationId: string) => {
    if (!token) return;
    if (!confirm('Resume this conversation? AI replies will resume for this contact.')) return;

    try {
      setResuming(conversationId);
      setError('');
      setSuccess('');
      const res = await fetch('/api/v1/handover/resume', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversationId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to resume');
      }
      setSuccess(`Conversation ${conversationId} resumed`);
      setHandovers(prev => prev.filter(h => h.conversationId !== conversationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume');
    } finally {
      setResuming(null);
    }
  };

  const formatTime = (iso: string) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  if (authLoading) return <div style={{ padding: '2rem' }}>Loading...</div>;

  return (
    <main style={{ padding: '2rem' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Handover Queue</h1>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.5rem' }}>
        <input
          type="text"
          placeholder="Tenant ID"
          value={tenantId}
          onChange={e => setTenantId(e.target.value)}
          style={{ padding: '0.5rem', fontSize: '0.875rem', width: '240px' }}
        />
        <button
          onClick={() => loadActiveHandovers(tenantId)}
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
      {success && (
        <div style={{ padding: '1rem', backgroundColor: '#d4edda', color: '#155724', marginBottom: '1rem', borderRadius: '4px' }}>
          {success}
        </div>
      )}

      {handovers.length === 0 && !loading && tenantId && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#666', border: '1px solid #eee', borderRadius: '8px' }}>
          No conversations currently in handover
        </div>
      )}

      {handovers.length === 0 && !tenantId && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
          Enter a Tenant ID to view handover queue
        </div>
      )}

      {handovers.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Contact</th>
              <th style={{ padding: '0.5rem' }}>Channel</th>
              <th style={{ padding: '0.5rem' }}>Type</th>
              <th style={{ padding: '0.5rem' }}>Initiated By</th>
              <th style={{ padding: '0.5rem' }}>Note</th>
              <th style={{ padding: '0.5rem' }}>Paused At</th>
              <th style={{ padding: '0.5rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {handovers.map(h => (
              <tr key={h.conversationId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem' }}>{h.contactId || '—'}</td>
                <td style={{ padding: '0.5rem' }}>{h.channel}</td>
                <td style={{ padding: '0.5rem' }}>{h.handoverType}</td>
                <td style={{ padding: '0.5rem' }}>{h.initiatedBy}</td>
                <td style={{ padding: '0.5rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.note || '—'}
                </td>
                <td style={{ padding: '0.5rem' }}>{formatTime(h.createdAt)}</td>
                <td style={{ padding: '0.5rem' }}>
                  <button
                    onClick={() => handleResume(h.conversationId)}
                    disabled={resuming === h.conversationId}
                    style={{
                      padding: '0.3rem 0.75rem',
                      backgroundColor: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: resuming === h.conversationId ? 'not-allowed' : 'pointer',
                      opacity: resuming === h.conversationId ? 0.6 : 1,
                    }}
                  >
                    {resuming === h.conversationId ? 'Resuming...' : 'Resume'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
