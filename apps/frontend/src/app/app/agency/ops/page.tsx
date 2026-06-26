'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  ErrorBanner,
  KeyValueRows,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  EmptyState,
  mvpButtonStyle,
  mvpInputStyle,
  mvpSelectStyle,
  formatDateTime,
} from '@/components/app/mvp-ui';
import {
  getOpsHealth,
  getOpsFlags,
  getOpsOutboundSends,
  getOpsConversations,
  getOpsGhlSync,
  getOpsErrors,
  getOpsAuditEvents,
  getOpsTenants,
  getOpsQueues,
  type OpsHealth,
  type OpsFlag,
  type OpsOutboundSend,
  type OpsConversationHealth,
  type OpsGhlSync,
  type OpsErrorEvent,
  type OpsAuditEvent,
  type OpsTenantReadiness,
  type OpsQueueHealth,
} from '@/lib/api';

const TABS = [
  'Health', 'Flags', 'Outbound', 'GHL Sync', 'Conversations',
  'Tenants', 'Errors', 'Audit', 'Queues', 'SOP',
] as const;
type Tab = (typeof TABS)[number];

const kpiCardShell: CSSProperties = {
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  borderRadius: '14px',
  padding: '1.25rem 1.35rem',
  background: 'var(--aisbp-surface, #ffffff)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  display: 'flex', flexDirection: 'column', gap: '0.5rem',
  minHeight: '100px',
};
const kpiTitle: CSSProperties = {
  fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--aisbp-muted, #94a3b8)', margin: 0,
};
const kpiFigure: CSSProperties = {
  fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.03em',
  lineHeight: 1.05, color: 'var(--aisbp-text-heading, #0f172a)', margin: '0.15rem 0 0',
};
const tabBarStyle: CSSProperties = {
  display: 'flex', gap: '0.1rem', marginBottom: '1.25rem',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)', flexWrap: 'nowrap',
};
const thStyle: CSSProperties = {
  padding: '0.5rem 0.55rem', fontWeight: 700, fontSize: '0.7rem',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--aisbp-muted, #94a3b8)', textAlign: 'left',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
};
const tdStyle: CSSProperties = {
  padding: '0.45rem 0.55rem', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
  color: 'var(--aisbp-text, #0f172a)', verticalAlign: 'middle', fontSize: '0.84rem',
};

function statusTone(s: string): 'ok' | 'bad' | 'warn' | 'neutral' {
  if (['sent', 'Healthy', 'Works', 'Connected', 'CONNECTED', 'Ready', 'active', 'info', 'OK'].includes(s)) return 'ok';
  if (['failed_provider_rejected', 'error', 'ERROR', 'Error'].includes(s)) return 'bad';
  if (['warn', 'stale_cancelled', 'duplicate_skipped', 'Needs backfill'].includes(s)) return 'warn';
  return 'neutral';
}

function uptimeFmt(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

const PAGE_SIZE = 10;

export default function OpsDashboardPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('Health');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [health, setHealth] = useState<OpsHealth | null>(null);
  const [flags, setFlags] = useState<OpsFlag[]>([]);
  const [outbound, setOutbound] = useState<OpsOutboundSend[]>([]);
  const [outboundTotal, setOutboundTotal] = useState(0);
  const [outboundPage, setOutboundPage] = useState(1);
  const [outboundSearch, setOutboundSearch] = useState('');
  const [outboundStatusFilter, setOutboundStatusFilter] = useState('');
  const [conversations, setConversations] = useState<OpsConversationHealth[]>([]);
  const [convPage, setConvPage] = useState(1);
  const [convTotal, setConvTotal] = useState(0);
  const [ghlSync, setGhlSync] = useState<OpsGhlSync[]>([]);
  const [errors, setErrors] = useState<OpsErrorEvent[]>([]);
  const [errorsTotal, setErrorsTotal] = useState(0);
  const [errorsPage, setErrorsPage] = useState(1);
  const [audit, setAudit] = useState<OpsAuditEvent[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [tenants, setTenants] = useState<OpsTenantReadiness[]>([]);
  const [queues, setQueues] = useState<OpsQueueHealth[]>([]);
  const [detailModal, setDetailModal] = useState<{ title: string; rows: Array<{ label: string; value: string }> } | null>(null);
  const [lastRefresh, setLastRefresh] = useState('');

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr('');
    try {
      const [h, f, s, qs] = await Promise.all([
        getOpsHealth(token).catch(() => null),
        getOpsFlags(token).catch(() => []),
        getOpsTenants(token).catch(() => []),
        getOpsQueues(token).catch(() => []),
      ]);
      setHealth(h);
      setFlags(f);
      setTenants(s);
      setQueues(qs);
      setLastRefresh(new Date().toISOString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchOutbound = useCallback(async () => {
    if (!token) return;
    try {
      const r = await getOpsOutboundSends(token, {
        page: outboundPage, pageSize: PAGE_SIZE,
        status: outboundStatusFilter || undefined,
        tenantId: outboundSearch || undefined,
      });
      setOutbound(r.data); setOutboundTotal(r.total);
    } catch { /* not fatal */ }
  }, [token, outboundPage, outboundStatusFilter, outboundSearch]);

  const fetchConversations = useCallback(async () => {
    if (!token) return;
    try {
      const r = await getOpsConversations(token, { page: convPage, pageSize: PAGE_SIZE });
      setConversations(r.data); setConvTotal(r.total);
    } catch { /* not fatal */ }
  }, [token, convPage]);

  const fetchGhlSync = useCallback(async () => {
    if (!token) return;
    try { setGhlSync(await getOpsGhlSync(token, { limit: 20 })); } catch { /* not fatal */ }
  }, [token]);

  const fetchErrors = useCallback(async () => {
    if (!token) return;
    try {
      const r = await getOpsErrors(token, { page: errorsPage, pageSize: PAGE_SIZE });
      setErrors(r.data); setErrorsTotal(r.total);
    } catch { /* not fatal */ }
  }, [token, errorsPage]);

  const fetchAudit = useCallback(async () => {
    if (!token) return;
    try {
      const r = await getOpsAuditEvents(token, { page: auditPage, pageSize: PAGE_SIZE });
      setAudit(r.data); setAuditTotal(r.total);
    } catch { /* not fatal */ }
  }, [token, auditPage]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { if (tab === 'Outbound') fetchOutbound(); }, [tab, fetchOutbound]);
  useEffect(() => { if (tab === 'Conversations') fetchConversations(); }, [tab, fetchConversations]);
  useEffect(() => { if (tab === 'GHL Sync') fetchGhlSync(); }, [tab, fetchGhlSync]);
  useEffect(() => { if (tab === 'Errors') fetchErrors(); }, [tab, fetchErrors]);
  useEffect(() => { if (tab === 'Audit') fetchAudit(); }, [tab, fetchAudit]);

  const copyCmd = (cmd: string) => { navigator.clipboard.writeText(cmd).catch(() => {}); };

  const renderPaginator = (page: number, total: number, setPage: (p: number) => void) => {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--aisbp-muted)' }}>
        <span>{total} row{total !== 1 ? 's' : ''}</span>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <button style={mvpButtonStyle} disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span>Page {page} / {totalPages}</span>
          <button style={mvpButtonStyle} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      </div>
    );
  };

  if (loading && !health) return <LoadingBlock message="Loading dashboard…" />;

  return (
    <div>
      <PageHeader title="Ops Dashboard" eyebrow="Operations" />
      {err && <ErrorBanner message={err} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={tabBarStyle} role="tablist">
          {TABS.map(t => {
            const active = tab === t;
            return (
              <button key={t} role="tab" aria-selected={active} onClick={() => setTab(t)}
                style={{
                  border: 'none', background: active ? 'var(--aisbp-tenant-nav-active-bg, rgba(15,98,254,0.1))' : 'transparent',
                  color: active ? 'var(--aisbp-tenant-nav-active-text, #0f62fe)' : 'var(--aisbp-muted, #64748b)',
                  padding: '0.4rem 0.5rem', borderRadius: '10px 10px 0 0', fontSize: '0.75rem', whiteSpace: 'nowrap', flexShrink: 0,
                  fontWeight: active ? 700 : 500, cursor: 'pointer',
                  borderBottom: active ? '2px solid var(--aisbp-tenant-nav-active-text, #0f62fe)' : '2px solid transparent',
                  marginBottom: '-1px',
                }}>{t}</button>
            );
          })}
        </div>
        <button style={mvpButtonStyle} onClick={fetchAll}>Refresh</button>
      </div>
      {lastRefresh && <p style={{ fontSize: '0.72rem', color: 'var(--aisbp-muted)', margin: '-0.5rem 0 1rem' }}>Last refresh: {formatDateTime(lastRefresh)}</p>}

      {tab === 'Health' && health && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={kpiCardShell}><p style={kpiTitle}>Backend</p><p style={kpiFigure}><StatusPill label={health.backend} tone="ok" /></p></div>
            <div style={kpiCardShell}><p style={kpiTitle}>Frontend</p><p style={kpiFigure}><StatusPill label={health.frontend} tone="ok" /></p></div>
            <div style={kpiCardShell}><p style={kpiTitle}>Redis</p><p style={kpiFigure}><StatusPill label={health.redis} tone="ok" /></p></div>
            <div style={kpiCardShell}><p style={kpiTitle}>Booking</p><p style={kpiFigure}><StatusPill label={health.bookingSave} tone={health.bookingSave === 'Works' ? 'ok' : 'bad'} /></p></div>
            <div style={kpiCardShell}><p style={kpiTitle}>Uptime</p><p style={kpiFigure}>{uptimeFmt(health.uptimeSec)}</p></div>
            <div style={kpiCardShell}><p style={kpiTitle}>Env</p><p style={kpiFigure}>{health.nodeEnv}</p></div>
          </div>
          <SectionCard title="System Info">
            <KeyValueRows rows={[
              { label: 'VPS Commit', value: health.vpsCommit, mono: true },
              { label: 'Stable Tag', value: health.stableTag, mono: true },
              { label: 'Uptime Seconds', value: String(health.uptimeSec) },
            ]} />
          </SectionCard>
        </>
      )}

      {tab === 'Flags' && (
        <SectionCard title="Runtime Feature Flags" subtitle="Read-only. Secrets filtered by the API.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead><tr>{['Flag', 'Value', 'Status'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {flags.map(f => (
                  <tr key={f.key}>
                    <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{f.key}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{f.value}</td>
                    <td style={tdStyle}><StatusPill label={f.value === 'true' ? 'Active' : f.value === 'false' ? 'Off' : 'Set'} tone={f.value === 'true' ? 'ok' : 'neutral'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {flags.length === 0 && <EmptyState title="No flags loaded" compact />}
        </SectionCard>
      )}

      {tab === 'Outbound' && (
        <SectionCard title="Outbound Sends" subtitle="Live data from outbound_sends ledger.">
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <input placeholder="Search tenant..." style={{ ...mvpInputStyle, width: '180px', marginTop: 0 }} value={outboundSearch} onChange={e => { setOutboundSearch(e.target.value); setOutboundPage(1); }} />
            <select style={{ ...mvpSelectStyle, width: '150px', marginTop: 0 }} value={outboundStatusFilter} onChange={e => { setOutboundStatusFilter(e.target.value); setOutboundPage(1); }}>
              <option value="">All</option>
              <option value="sent">sent</option>
              <option value="failed_provider_rejected">failed</option>
            </select>
          </div>
          {outbound.length === 0 ? <EmptyState title="No outbound sends" compact /> : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', minWidth: '800px' }}>
                  <thead><tr>{['Status','Tenant','Conv','Reply','Seq','Provider Msg','Att','Error','Sent'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {outbound.map(r => (
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailModal({ title: `Outbound ${r.id}`, rows: [
                        { label:'ID',value:r.id },{ label:'Tenant',value:r.tenantId },{ label:'Conversation',value:r.conversationId },
                        { label:'Reply',value:r.replyId },{ label:'Bubble',value:String(r.bubbleSequence) },
                        { label:'Provider Msg',value:r.providerMessageId||'—' },{ label:'Attempt',value:String(r.attempt) },
                        { label:'Error',value:r.lastErrorMessage||r.lastErrorCode||'—' },
                        { label:'Sent',value:r.sentAt?formatDateTime(r.sentAt):'—' },{ label:'Created',value:formatDateTime(r.createdAt) },
                      ]})}>
                        <td style={tdStyle}><StatusPill label={r.status} tone={statusTone(r.status)} /></td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{r.tenantId.slice(0,8)}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{r.conversationId.slice(0,8)}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{r.replyId.slice(0,8)}</td>
                        <td style={tdStyle}>{r.bubbleSequence}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{r.providerMessageId||'—'}</td>
                        <td style={tdStyle}>{r.attempt}</td>
                        <td style={{...tdStyle,color:r.lastErrorMessage?'var(--aisbp-pill-bad-fg)':undefined,fontSize:'0.78rem',maxWidth:'180px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.lastErrorMessage||r.lastErrorCode||'—'}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{r.sentAt?formatDateTime(r.sentAt):'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderPaginator(outboundPage, outboundTotal, setOutboundPage)}
            </>
          )}
        </SectionCard>
      )}

      {tab === 'GHL Sync' && (
        <SectionCard title="GHL Pre-Reply Context Sync" subtitle="Recent sync events from metrics_events.">
          {ghlSync.length === 0 ? <EmptyState title="No sync events" compact /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead><tr>{['Event','Tenant','Conversation','Details','Time'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {ghlSync.map((s, i) => {
                    const meta = s.metadata as Record<string,unknown>|null;
                    return (
                      <tr key={i}>
                        <td style={tdStyle}><StatusPill label={s.eventType} tone={s.eventType.includes('failed')?'bad':s.eventType.includes('completed')?'ok':'neutral'} /></td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{s.tenantId.slice(0,8)}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{s.conversationId.slice(0,8)}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{meta ? JSON.stringify(meta).slice(0,100) : '—'}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{formatDateTime(s.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'Conversations' && (
        <SectionCard title="Conversation Health" subtitle="Recent conversations with stale/duplicate counts.">
          {conversations.length === 0 ? <EmptyState title="No conversations" compact /> : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', minWidth: '650px' }}>
                  <thead><tr>{['ID','Tenant','Contact','Last Msg','Stale Skip','Dup Skip','Status'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {conversations.map(c => (
                      <tr key={c.id}>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{c.id.slice(0,8)}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{c.tenantId.slice(0,8)}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{c.contactId}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{c.lastMessageAt?formatDateTime(c.lastMessageAt):'—'}</td>
                        <td style={tdStyle}>{c.staleSkipped>0?<StatusPill label={String(c.staleSkipped)} tone="warn"/>:'0'}</td>
                        <td style={tdStyle}>{c.duplicateSkipped>0?<StatusPill label={String(c.duplicateSkipped)} tone="warn"/>:'0'}</td>
                        <td style={tdStyle}><StatusPill label={c.status} tone={statusTone(c.status)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderPaginator(convPage, convTotal, setConvPage)}
            </>
          )}
        </SectionCard>
      )}

      {tab === 'Tenants' && (
        <SectionCard title="Tenant Readiness" subtitle="GHL connection, send history, known issues.">
          {tenants.length === 0 ? <EmptyState title="No tenants" compact /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', minWidth: '700px' }}>
                <thead><tr>{['Name','GHL','Location','Last OK','Last Fail','Bad Contacts','Sync','Status'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {tenants.map(t => {
                    const ready = t.ghlConnectionStatus === 'CONNECTED' && t.botEnabled && t.badContactIdCount === 0;
                    return (
                      <tr key={t.id}>
                        <td style={tdStyle}>{t.name}</td>
                        <td style={tdStyle}><StatusPill label={t.ghlConnectionStatus||'—'} tone={t.ghlConnectionStatus==='CONNECTED'?'ok':'warn'} /></td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{t.ghlLocationId||'—'}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{t.lastSuccessfulSendAt?formatDateTime(t.lastSuccessfulSendAt):'—'}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{t.lastFailedSendAt?formatDateTime(t.lastFailedSendAt):'—'}</td>
                        <td style={tdStyle}>{t.badContactIdCount>0?<StatusPill label={String(t.badContactIdCount)} tone="bad"/>:<StatusPill label="0" tone="ok"/>}</td>
                        <td style={tdStyle}><StatusPill label={t.syncEnabled?'On':'Off'} tone={t.syncEnabled?'ok':'neutral'} /></td>
                        <td style={tdStyle}><StatusPill label={ready?'Ready':'Needs review'} tone={ready?'ok':'warn'} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'Errors' && (
        <SectionCard title="Error Tracker" subtitle="Recent errors and warnings from metrics_events.">
          {errors.length === 0 ? <EmptyState title="No errors" compact /> : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', minWidth: '700px' }}>
                  <thead><tr>{['Sev','Source','Event','Tenant','Conv','Metadata','Time'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {errors.map(e => (
                      <tr key={e.id}>
                        <td style={tdStyle}><StatusPill label={e.severity} tone={e.severity==='error'?'bad':'warn'} /></td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{e.eventSource}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{e.eventType}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{e.tenantId?.slice(0,8)||'—'}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{e.conversationId?.slice(0,8)||'—'}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem',maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.metadata?JSON.stringify(e.metadata).slice(0,80):'—'}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{formatDateTime(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderPaginator(errorsPage, errorsTotal, setErrorsPage)}
            </>
          )}
        </SectionCard>
      )}

      {tab === 'Audit' && (
        <SectionCard title="Audit / Metrics Events" subtitle="Recent events from metrics_events.">
          {audit.length === 0 ? <EmptyState title="No events" compact /> : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', minWidth: '600px' }}>
                  <thead><tr>{['Event','Source','Sev','Tenant','Conv','Time'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {audit.map(e => (
                      <tr key={e.id}>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{e.eventType}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{e.eventSource}</td>
                        <td style={tdStyle}><StatusPill label={e.severity} tone={e.severity==='error'?'bad':e.severity==='warn'?'warn':'ok'} /></td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{e.tenantId?.slice(0,8)||'—'}</td>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{e.conversationId?.slice(0,8)||'—'}</td>
                        <td style={{...tdStyle,fontSize:'0.78rem'}}>{formatDateTime(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderPaginator(auditPage, auditTotal, setAuditPage)}
            </>
          )}
        </SectionCard>
      )}

      {tab === 'Queues' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            {Object.entries(queues.reduce((acc,q) => { acc['waiting']=(acc['waiting']||0)+q.waiting; acc['active']=(acc['active']||0)+q.active; acc['failed']=(acc['failed']||0)+q.failed; acc['delayed']=(acc['delayed']||0)+q.delayed; return acc; },{} as Record<string,number>)).map(([k,v]) => (
              <div key={k} style={kpiCardShell}><p style={kpiTitle}>{k}</p><p style={kpiFigure}>{v}</p></div>
            ))}
          </div>
          <SectionCard title="Per-Queue Details">
            {queues.length === 0 ? <EmptyState title="No queue data" compact /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                  <thead><tr>{['Queue','Waiting','Active','Failed','Delayed'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {queues.map(q => (
                      <tr key={q.queue}>
                        <td style={{...tdStyle,fontFamily:'inherit',fontSize:'0.78rem'}}>{q.queue}</td>
                        <td style={tdStyle}>{q.waiting}</td>
                        <td style={tdStyle}>{q.active>0?<StatusPill label={String(q.active)} tone="ok"/>:'0'}</td>
                        <td style={tdStyle}>{q.failed>0?<StatusPill label={String(q.failed)} tone="bad"/>:'0'}</td>
                        <td style={tdStyle}>{q.delayed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {tab === 'SOP' && (
        <>
          <SectionCard title="Rollback Commands" subtitle="Copy for reference only — no live actions.">
            <KeyValueRows rows={[
              { label: 'Flag rollback', value: <span style={{display:'flex',alignItems:'center',gap:'0.5rem',flexWrap:'wrap'}}><code style={{fontFamily:'inherit',fontSize:'0.8rem',background:'var(--aisbp-card-subtle)',padding:'0.25rem 0.5rem',borderRadius:'6px'}}>sed -i &apos;s/^FLAG=true$/FLAG=false/&apos; /root/aisbp/.env.production</code><button style={mvpButtonStyle} onClick={()=>copyCmd("cd /root/aisbp && sed -i 's/^AISBP_XXX_ENABLED=true$/AISBP_XXX_ENABLED=false/' .env.production && docker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --no-build --force-recreate backend")}>Copy</button></span> },
              { label: 'Deploy rollback', value: <span style={{display:'flex',alignItems:'center',gap:'0.5rem',flexWrap:'wrap'}}><code style={{fontFamily:'inherit',fontSize:'0.8rem',background:'var(--aisbp-card-subtle)',padding:'0.25rem 0.5rem',borderRadius:'6px'}}>git checkout {health?.stableTag||'stable-...'}</code><button style={mvpButtonStyle} onClick={()=>copyCmd(`cd /root/aisbp && git fetch origin && git checkout ${health?.stableTag||'stable-...'} && docker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --no-build --force-recreate backend`)}>Copy</button></span> },
            ]} />
          </SectionCard>
          <SectionCard title="Reference">
            <KeyValueRows rows={[
              { label: 'Stable tag', value: health?.stableTag||'—', mono: true },
              { label: 'VPS commit', value: health?.vpsCommit||'—', mono: true },
              { label: 'Production URL', value: 'https://kb.aisalesbot.pro' },
              { label: 'Dashboard', value: 'Read-only — no actions available', mono: true },
            ]} />
          </SectionCard>
        </>
      )}

      {detailModal && (
        <div style={{ position:'fixed',inset:0,zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--aisbp-overlay)' }}
          onClick={() => setDetailModal(null)}>
          <div style={{ background:'var(--aisbp-modal-bg)',borderRadius:'12px',padding:'1.5rem',maxWidth:'480px',width:'90%',boxShadow:'0 12px 40px rgba(0,0,0,0.12)',border:'1px solid var(--aisbp-modal-border)',maxHeight:'80vh',overflowY:'auto' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{fontSize:'1.1rem',fontWeight:700,margin:'0 0 1rem',color:'var(--aisbp-text-heading)'}}>{detailModal.title}</h3>
            <KeyValueRows rows={detailModal.rows} />
            <div style={{marginTop:'1rem',textAlign:'right'}}><button style={mvpButtonStyle} onClick={()=>setDetailModal(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
