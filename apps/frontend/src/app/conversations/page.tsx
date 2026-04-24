'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface Conversation {
  id: string;
  ghl_conversation_id: string;
  contact_id: string;
  channel: string;
  status: string;
  last_message_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Message {
  id: string;
  direction: string;
  sender: string;
  content: string;
  content_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export default function ConversationLogsPage() {
  const { token, loading: authLoading } = useAuth();

  const [tenantId, setTenantId] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Detail view state
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    if (!authLoading && token) {
      // Default to first available tenant from JWT context
      // In a real app, this would come from a tenant selector
      const tenantFromToken = (token as string);
      // For now, conversations require a tenantId param
    }
  }, [token, authLoading]);

  const loadConversations = async (tid: string, status?: string) => {
    if (!token || !tid) return;
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ tenantId: tid });
      if (status) params.set('status', status);
      const res = await fetch(`/api/v1/conversations?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load conversations');
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    if (!token) return;
    try {
      setLoadingMessages(true);
      const res = await fetch(`/api/v1/conversations/${conversationId}/messages?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleViewConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
    loadMessages(conv.id);
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
      ACTIVE: '#d4edda',
      HANDOVER: '#fff3cd',
      CLOSED: '#e9ecef',
      PENDING: '#e9ecef',
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

  return (
    <main style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>Conversations</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
            <option value="ACTIVE">Active</option>
            <option value="HANDOVER">Handover</option>
            <option value="CLOSED">Closed</option>
            <option value="PENDING">Pending</option>
          </select>
          <button
            onClick={() => loadConversations(tenantId, statusFilter)}
            disabled={!tenantId || loading}
            style={{ padding: '0.5rem 1rem', cursor: tenantId ? 'pointer' : 'not-allowed', opacity: tenantId ? 1 : 0.5 }}
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: '#f8d7da', color: '#721c24', marginBottom: '1rem', borderRadius: '4px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selectedConversation ? '1fr 1fr' : '1fr', gap: '1rem' }}>
        {/* Conversation list */}
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem' }}>Contact</th>
                <th style={{ padding: '0.5rem' }}>Channel</th>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Last Message</th>
                <th style={{ padding: '0.5rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {conversations.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                    {tenantId ? 'No conversations found' : 'Enter a subaccount ID to load conversations'}
                  </td>
                </tr>
              )}
              {conversations.map(conv => (
                <tr
                  key={conv.id}
                  style={{ borderBottom: '1px solid #eee', backgroundColor: selectedConversation?.id === conv.id ? '#f0f0f0' : 'transparent' }}
                >
                  <td style={{ padding: '0.5rem' }}>{conv.contact_id || '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{conv.channel}</td>
                  <td style={{ padding: '0.5rem' }}>{getStatusBadge(conv.status)}</td>
                  <td style={{ padding: '0.5rem' }}>{formatTime(conv.last_message_at)}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <button onClick={() => handleViewConversation(conv)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Message panel */}
        {selectedConversation && (
          <div style={{ borderLeft: '1px solid #ccc', paddingLeft: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem' }}>Messages</h2>
              <button onClick={() => setSelectedConversation(null)} style={{ padding: '0.25rem 0.5rem' }}>Close</button>
            </div>
            <div style={{ marginBottom: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
              <div>Conversation: {selectedConversation.ghl_conversation_id}</div>
              <div>Contact: {selectedConversation.contact_id}</div>
            </div>
            {loadingMessages ? (
              <div>Loading messages...</div>
            ) : (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {messages.length === 0 && <div style={{ color: '#666' }}>No messages</div>}
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    style={{
                      marginBottom: '0.75rem',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      backgroundColor: msg.direction === 'INBOUND' ? '#e8f4fd' : '#dcf8c0',
                      textAlign: msg.direction === 'INBOUND' ? 'left' : 'right',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>
                      {msg.sender} · {formatTime(msg.created_at)}
                    </div>
                    <div style={{ fontSize: '0.875rem' }}>{msg.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
