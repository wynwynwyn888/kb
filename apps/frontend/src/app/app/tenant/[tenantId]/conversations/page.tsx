'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getConversations, getConversationMessages, resetConversationBotState } from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  formatDateTime,
} from '@/components/app/mvp-ui';

type ConvRow = {
  id: string;
  ghl_conversation_id?: string;
  contact_id?: string;
  channel?: string;
  status?: string;
  last_message_at?: string | null;
};

type MessageRow = {
  id: string;
  direction?: string;
  sender?: string | null;
  content?: string | null;
  content_type?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

function shortId(s: string, len = 10): string {
  if (s.length <= len) return s;
  return `${s.slice(0, len)}…`;
}

export default function TenantConversationsReadonlyPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetBanner, setResetBanner] = useState('');

  useEffect(() => {
    if (!token || !tenantId) {
      setListLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setListLoading(true);
      setListErr('');
      try {
        const r = await getConversations(token, tenantId);
        if (cancelled) return;
        setRows((r.conversations ?? []) as ConvRow[]);
      } catch (e) {
        if (!cancelled) setListErr(e instanceof Error ? e.message : 'Failed to list');
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId]);

  useEffect(() => {
    if (!token || !sel) {
      setMessages([]);
      setMsgErr('');
      return;
    }
    let cancelled = false;
    (async () => {
      setMsgLoading(true);
      setMsgErr('');
      try {
        const m = await getConversationMessages(token, sel, { limit: 50 });
        const arr = Array.isArray(m) ? (m as MessageRow[]) : [];
        // API returns newest-first; show chronological for reading
        const chronological = [...arr].reverse();
        if (!cancelled) setMessages(chronological);
      } catch (e) {
        if (!cancelled) {
          setMessages([]);
          setMsgErr(e instanceof Error ? e.message : 'Failed to load messages');
        }
      } finally {
        if (!cancelled) setMsgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, sel]);

  const selected = rows.find(c => c.id === sel);

  return (
    <div>
      <PageHeader title="Activity" eyebrow="Advanced" />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: '640px' }}>
        Read synced threads here. Sending replies still happens in CRM (or your production stack)—there is no
        send box in this panel.
      </p>
      {listErr && <ErrorBanner message={listErr} />}

      <div
        style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'stretch',
          flexWrap: 'wrap',
          marginTop: '1rem',
        }}
      >
        <div
          style={{
            flex: '0 0 300px',
            maxWidth: '100%',
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            background: '#fafafa',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'min(70vh, 640px)',
          }}
        >
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderBottom: '1px solid #e5e5e5',
              fontWeight: 600,
              fontSize: '0.85rem',
              background: '#fff',
              borderRadius: '8px 8px 0 0',
            }}
          >
            Threads ({rows.length})
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {listLoading ? (
              <div style={{ padding: '0.85rem' }}>
                <LoadingBlock message="Loading list…" />
              </div>
            ) : rows.length === 0 ? (
              <div style={{ padding: '0.85rem' }}>
                <EmptyState
                  compact
                  title="No conversations yet"
                  detail="When threads sync for this subaccount, they will list here. Check Connection under More if you expected data already."
                />
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rows.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSel(c.id)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.65rem 0.85rem',
                        border: 'none',
                        borderBottom: '1px solid #eee',
                        background: sel === c.id ? '#e8f3ff' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111' }}>
                        {c.ghl_conversation_id ? shortId(c.ghl_conversation_id, 14) : shortId(c.id, 12)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.2rem' }}>
                        {c.channel ?? '—'} · {c.status ?? '—'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.15rem' }}>
                        Updated {formatDateTime(c.last_message_at ?? undefined)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div
          style={{
            flex: '1 1 320px',
            minWidth: '280px',
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'min(70vh, 640px)',
          }}
        >
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderBottom: '1px solid #e5e5e5',
              fontWeight: 600,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              Messages
              {selected ? (
                <span style={{ fontWeight: 400, color: '#666', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                  · Contact {selected.contact_id ? shortId(selected.contact_id, 12) : '—'}
                </span>
              ) : null}
            </div>
            {selected ? (
              <button
                type="button"
                disabled={resetBusy || !token}
                onClick={async () => {
                  setResetBanner('');
                  setResetBusy(true);
                  try {
                    await resetConversationBotState(token!, sel!);
                    setResetBanner('Bot state cleared for this thread. A short confirmation is queued to the contact.');
                  } catch (e) {
                    setResetBanner(e instanceof Error ? e.message : 'Reset failed');
                  } finally {
                    setResetBusy(false);
                  }
                }}
                style={{
                  fontSize: '0.75rem',
                  padding: '0.35rem 0.65rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  cursor: resetBusy ? 'wait' : 'pointer',
                }}
              >
                {resetBusy ? 'Resetting…' : 'Reset bot state'}
              </button>
            ) : null}
          </div>
          {resetBanner ? (
            <div
              style={{
                padding: '0.5rem 0.85rem',
                fontSize: '0.78rem',
                color: resetBanner.includes('fail') || resetBanner.includes('HTTP') ? '#b91c1c' : '#0f766e',
                background: '#f0fdf4',
                borderBottom: '1px solid #e5e5e5',
              }}
            >
              {resetBanner}
            </div>
          ) : null}
          <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>
            {!sel ? (
              <EmptyState title="Select a thread" detail="Choose a conversation on the left to load its messages." />
            ) : msgErr ? (
              <ErrorBanner message={msgErr} />
            ) : msgLoading ? (
              <LoadingBlock message="Loading messages…" />
            ) : messages.length === 0 ? (
              <EmptyState
                title="No messages in this thread"
                detail="The thread exists but has no messages yet, or sync has not brought them in."
              />
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {messages.map(m => {
                  const inbound = (m.direction || '').toUpperCase() === 'INBOUND';
                  return (
                    <li
                      key={m.id}
                      style={{
                        display: 'flex',
                        justifyContent: inbound ? 'flex-start' : 'flex-end',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: 'min(100%, 520px)',
                          padding: '0.5rem 0.75rem',
                          borderRadius: '8px',
                          fontSize: '0.85rem',
                          lineHeight: 1.45,
                          background: inbound ? '#f0f0f0' : '#0070f3',
                          color: inbound ? '#111' : '#fff',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '0.72rem',
                            opacity: 0.9,
                            marginBottom: '0.25rem',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.35rem',
                            justifyContent: inbound ? 'flex-start' : 'flex-end',
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>
                            {inbound ? 'Inbound' : 'Outbound'}
                          </span>
                          <span>·</span>
                          <span>{m.sender?.trim() || '—'}</span>
                          <span>·</span>
                          <span>{formatDateTime(m.created_at)}</span>
                          {m.content_type ? (
                            <>
                              <span>·</span>
                              <span>{m.content_type}</span>
                            </>
                          ) : null}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {m.content ?? '(no body)'}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
