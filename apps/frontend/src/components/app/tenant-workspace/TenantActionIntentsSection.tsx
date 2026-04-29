'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getActionIntents } from '@/lib/api';
import { EmptyState, ErrorBanner, KeyValueRows, LoadingBlock, SectionCard, StatusPill, formatDateTime } from '@/components/app/mvp-ui';

type IntentRow = Record<string, unknown>;

function intentField(row: IntentRow, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] !== undefined && row[k] !== null) return row[k];
  }
  return undefined;
}

function formatParams(p: unknown): string {
  if (p == null) return '—';
  if (typeof p === 'string') return p;
  try {
    return JSON.stringify(p);
  } catch {
    return String(p);
  }
}

export function TenantActionIntentsSection({ tenantId }: { tenantId: string }) {
  const { token } = useAuth();
  const [intents, setIntents] = useState<{ items: IntentRow[]; total: number } | null>(null);
  const [iLoading, setILoading] = useState(true);
  const [iErr, setIErr] = useState('');

  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    (async () => {
      setILoading(true);
      setIErr('');
      try {
        const i = await getActionIntents(token, tenantId, { limit: 20 });
        if (cancelled) return;
        const raw = i.intents ?? [];
        setIntents({ items: raw as IntentRow[], total: i.total ?? raw.length });
      } catch (e) {
        if (!cancelled) {
          setIErr(e instanceof Error ? e.message : String(e));
          setIntents(null);
        }
      } finally {
        if (!cancelled) setILoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId]);

  return (
    <SectionCard title="Recent action checks" subtitle="Automated actions the system considered or ran (read-only audit trail).">
      {iLoading ? <LoadingBlock message="Loading…" /> : null}
      {iErr ? <ErrorBanner message={iErr} /> : null}
      {!iLoading && !iErr && intents && intents.items.length === 0 ? (
        <EmptyState title="No action checks yet" detail="When the system logs possible actions for this workspace, they will show here." />
      ) : null}
      {!iLoading && !iErr && intents && intents.items.length > 0 ? (
        <>
          <p style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', marginTop: 0, marginBottom: '0.75rem' }}>
            Showing {intents.items.length} of {intents.total} total
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {intents.items.map((row, idx) => {
              const id = String(intentField(row, 'id') ?? idx);
              const actionType = String(intentField(row, 'action_type', 'actionType') ?? '—');
              const source = String(intentField(row, 'source') ?? '—');
              const status = String(intentField(row, 'status') ?? '—');
              const reason = intentField(row, 'reason');
              const gating = intentField(row, 'gating_note', 'gatingNote');
              const convId = String(intentField(row, 'conversation_id', 'conversationId') ?? '—');
              const created = intentField(row, 'created_at', 'createdAt');
              const executed = intentField(row, 'executed_at', 'executedAt');
              const params = intentField(row, 'params');
              const statusTone =
                status === 'EXECUTED' || status === 'COMPLETED'
                  ? 'ok'
                  : status === 'FAILED' || status === 'REJECTED'
                    ? 'bad'
                    : 'neutral';

              return (
                <li
                  key={id}
                  style={{
                    border: '1px solid var(--aisbp-border, #e5e5e5)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    background: 'var(--aisbp-surface, #fff)',
                  }}
                >
                  <div style={{ marginBottom: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                    <StatusPill label={status} tone={statusTone} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-text-secondary, #555)', fontFamily: 'inherit' }}>{actionType}</span>
                  </div>
                  <KeyValueRows
                    rows={[
                      { label: 'ID', value: id, mono: true },
                      { label: 'Source', value: source },
                      { label: 'Conversation', value: convId, mono: true },
                      {
                        label: 'Created',
                        value: typeof created === 'string' ? formatDateTime(created) : '—',
                      },
                      {
                        label: 'Executed',
                        value: typeof executed === 'string' ? formatDateTime(executed) : '—',
                      },
                      {
                        label: 'Reason',
                        value: typeof reason === 'string' && reason.trim() ? reason : '—',
                      },
                      {
                        label: 'Review note',
                        value: typeof gating === 'string' && gating.trim() ? gating : '—',
                      },
                      {
                        label: 'Details',
                        value: (
                          <span style={{ fontFamily: 'inherit', fontSize: '0.78rem' }}>{formatParams(params)}</span>
                        ),
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </SectionCard>
  );
}
