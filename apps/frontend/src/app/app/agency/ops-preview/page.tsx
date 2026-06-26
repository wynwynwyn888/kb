'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import {
  ErrorBanner,
  KeyValueRows,
  PageHeader,
  SectionCard,
  StatusPill,
  SuccessBanner,
  EmptyState,
  mvpButtonStyle,
  mvpInputStyle,
  mvpSelectStyle,
  formatDateTime,
} from '@/components/app/mvp-ui';
import {
  getMockFlags,
  getMockOutboundSends,
  getMockGhlSync,
  getMockConversationHealth,
  getMockTenantReadiness,
  getMockErrorEvents,
  getMockAuditEvents,
  getMockQueueStats,
  type MockFlag,
  type MockOutboundSend,
  type MockGhlSync,
  type MockConversationHealth,
  type MockTenantReadiness,
  type MockErrorEvent,
  type MockAuditEvent,
  type MockQueueStats,
} from './mock-data';

const TABS = [
  'Health',
  'Flags',
  'Outbound',
  'GHL Sync',
  'Conversations',
  'Tenants',
  'Errors',
  'Audit',
  'Queues',
  'SOP',
] as const;
type Tab = (typeof TABS)[number];

const kpiCardShell: CSSProperties = {
  border: '1px solid var(--aisbp-border, #e2e8f0)',
  borderRadius: '14px',
  padding: '1.25rem 1.35rem',
  background: 'var(--aisbp-surface, #ffffff)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  minHeight: '120px',
};

const kpiTitle: CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
  color: 'var(--aisbp-muted, #94a3b8)',
  margin: 0,
};

const kpiFigure: CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 800,
  letterSpacing: '-0.03em',
  lineHeight: 1.05,
  color: 'var(--aisbp-text-heading, #0f172a)',
  margin: '0.15rem 0 0',
};

const kpiMuted: CSSProperties = {
  fontSize: '0.82rem',
  color: 'var(--aisbp-muted, #64748b)',
  lineHeight: 1.45,
  margin: 0,
};

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: '0.25rem',
  marginBottom: '1.25rem',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
  paddingBottom: 0,
  overflowX: 'auto',
  flexWrap: 'nowrap',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.84rem',
};

const thStyle: CSSProperties = {
  padding: '0.5rem 0.55rem',
  fontWeight: 700,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--aisbp-muted, #94a3b8)',
  textAlign: 'left',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
};

const tdStyle: CSSProperties = {
  padding: '0.45rem 0.55rem',
  borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
  color: 'var(--aisbp-text, #0f172a)',
  verticalAlign: 'middle',
};

function statusTone(s: string): 'ok' | 'bad' | 'warn' | 'neutral' {
  if (['sent', 'OK', 'Ready', 'CONNECTED', 'Healthy', 'Works', 'active'].includes(s)) return 'ok';
  if (['failed_provider_rejected', 'error'].includes(s)) return 'bad';
  if (['Needs backfill', 'warn', 'stale_cancelled', 'UNKNOWN'].includes(s)) return 'warn';
  return 'neutral';
}

function severityTone(s: string): 'ok' | 'bad' | 'warn' | 'neutral' {
  if (s === 'info') return 'ok';
  if (s === 'error') return 'bad';
  if (s === 'warn') return 'warn';
  return 'neutral';
}

const PAGE_SIZE = 5;

export default function OpsPreviewPage() {
  const [tab, setTab] = useState<Tab>('Health');
  const [refreshedAt, setRefreshedAt] = useState<string>(() => new Date().toISOString());
  const [detailModal, setDetailModal] = useState<{ title: string; rows: Array<{ label: string; value: string }> } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const mockFlags = useMemo(() => getMockFlags(), [refreshedAt]);
  const mockOutbound = useMemo(() => getMockOutboundSends(), [refreshedAt]);
  const mockGhlSync = useMemo(() => getMockGhlSync(), [refreshedAt]);
  const mockConvHealth = useMemo(() => getMockConversationHealth(), [refreshedAt]);
  const mockTenants = useMemo(() => getMockTenantReadiness(), [refreshedAt]);
  const mockErrors = useMemo(() => getMockErrorEvents(), [refreshedAt]);
  const mockAudit = useMemo(() => getMockAuditEvents(), [refreshedAt]);
  const mockQueues = useMemo(() => getMockQueueStats(), [refreshedAt]);

  const filteredOutbound = useMemo(() => {
    let rows = [...mockOutbound];
    if (search) rows = rows.filter(r => r.conversationId.includes(search) || r.replyId.includes(search) || r.status.includes(search));
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
    return rows;
  }, [mockOutbound, search, statusFilter]);

  const pagedOutbound = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOutbound.slice(start, start + PAGE_SIZE);
  }, [filteredOutbound, page]);

  const totalOutboundPages = Math.max(1, Math.ceil(filteredOutbound.length / PAGE_SIZE));

  const copySop = (cmd: string) => {
    navigator.clipboard.writeText(cmd).catch(() => {});
  };

  const renderHealth = () => (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {[
          { label: 'Backend', value: 'Healthy', tone: 'ok' as const },
          { label: 'Frontend', value: 'HTTP 200', tone: 'ok' as const },
          { label: 'Redis', value: 'Healthy', tone: 'ok' as const },
          { label: 'Booking Save', value: 'Works', tone: 'ok' as const },
        ].map(({ label, value, tone }) => (
          <div key={label} style={kpiCardShell}>
            <p style={kpiTitle}>{label}</p>
            <p style={kpiFigure}><StatusPill label={value} tone={tone} /></p>
          </div>
        ))}
      </div>
      <SectionCard title="System Info">
        <KeyValueRows rows={[
          { label: 'VPS Commit', value: 'd3b72ce', mono: true },
          { label: 'Stable Tag', value: 'stable-single-brain-tested-2026-06-26', mono: true },
          { label: 'Last Deploy', value: formatDateTime(refreshedAt) },
          { label: 'Uptime', value: '~2h 15m' },
        ]} />
      </SectionCard>
    </>
  );

  const renderFlags = () => (
    <SectionCard title="Runtime Feature Flags" subtitle="Read-only — no toggles active in this preview.">
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Flag</th>
              <th style={thStyle}>Value</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Note</th>
            </tr>
          </thead>
          <tbody>
            {mockFlags.map(f => (
              <tr key={f.key}>
                <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.8rem' }}>{f.key}</td>
                <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.8rem' }}>{f.value}</td>
                <td style={tdStyle}><StatusPill label={f.enabled ? 'Active' : 'Off'} tone={f.enabled ? 'ok' : 'neutral'} /></td>
                <td style={{ ...tdStyle, color: 'var(--aisbp-muted)', fontSize: '0.78rem' }}>{f.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  const renderOutbound = () => (
    <SectionCard title="Outbound Sends" subtitle="Mock data — local filter, search, and pagination only.">
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search ID / status..."
          style={{ ...mvpInputStyle, width: '220px', marginTop: 0 }}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
        <select style={{ ...mvpSelectStyle, width: '180px', marginTop: 0 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="all">All statuses</option>
          <option value="sent">sent</option>
          <option value="failed_provider_rejected">failed</option>
          <option value="duplicate_skipped">duplicate skipped</option>
          <option value="stale_cancelled">stale cancelled</option>
        </select>
      </div>
      {pagedOutbound.length === 0 ? (
        <EmptyState title="No matching rows" compact />
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...tableStyle, minWidth: '800px' }}>
              <thead>
                <tr>
                  {['Status', 'Tenant', 'Conversation', 'Reply ID', 'Bubble #', 'Provider Msg ID', 'Attempt', 'Error', 'Sent At'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedOutbound.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailModal({
                    title: `Outbound Send ${r.id}`,
                    rows: [
                      { label: 'ID', value: r.id },
                      { label: 'Tenant', value: r.tenantId },
                      { label: 'Conversation', value: r.conversationId },
                      { label: 'Reply ID', value: r.replyId },
                      { label: 'Bubble Sequence', value: String(r.bubbleSequence) },
                      { label: 'Provider Message ID', value: r.providerMessageId || '—' },
                      { label: 'Attempt', value: String(r.attempt) },
                      { label: 'Error', value: r.lastError || '—' },
                      { label: 'Sent At', value: r.sentAt ? formatDateTime(r.sentAt) : '—' },
                      { label: 'Created At', value: formatDateTime(r.createdAt) },
                    ],
                  })}>
                    <td style={tdStyle}><StatusPill label={r.status} tone={statusTone(r.status)} /></td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{r.tenantId.slice(0, 8)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{r.conversationId}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{r.replyId}</td>
                    <td style={tdStyle}>{r.bubbleSequence}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{r.providerMessageId || '—'}</td>
                    <td style={tdStyle}>{r.attempt}</td>
                    <td style={{ ...tdStyle, color: r.lastError ? 'var(--aisbp-pill-bad-fg, #b91c1c)' : undefined, fontSize: '0.78rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.lastError || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{r.sentAt ? formatDateTime(r.sentAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--aisbp-muted)' }}>
            <span>{filteredOutbound.length} row{filteredOutbound.length !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <button style={mvpButtonStyle} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</button>
              <span>Page {page} / {totalOutboundPages}</span>
              <button style={mvpButtonStyle} disabled={page >= totalOutboundPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );

  const renderGhlSync = () => (
    <SectionCard title="GHL Pre-Reply Context Sync" subtitle="Mock data — shows sync results including manual message imports.">
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {['Last Sync', 'Fetched', 'Inserted', 'Deduped', 'App Skipped', 'Latency', 'Error', 'Note'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockGhlSync.map((s, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{formatDateTime(s.lastSync)}</td>
                <td style={tdStyle}>{s.fetched}</td>
                <td style={tdStyle}>{s.inserted}</td>
                <td style={tdStyle}>{s.deduped}</td>
                <td style={tdStyle}>{s.appSkipped}</td>
                <td style={tdStyle}>{s.latencyMs}ms</td>
                <td style={tdStyle}>{s.lastError ? <StatusPill label="Error" tone="bad" /> : <StatusPill label="None" tone="ok" />}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem', maxWidth: '280px' }}>{s.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  const renderConversations = () => (
    <SectionCard title="Conversation Health" subtitle="Mock data — shows stale/duplicate counts and message timestamps.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, minWidth: '700px' }}>
          <thead>
            <tr>
              {['Conv ID', 'Contact', 'Last Inbound', 'Last AI Reply', 'Last Manual', 'Stale Skip', 'Dup Skip', 'Status'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockConvHealth.map(c => (
              <tr key={c.conversationId + c.contactId}>
                <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{c.conversationId}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.contactId}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{c.lastInbound ? formatDateTime(c.lastInbound) : '—'}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{c.lastAiReply ? formatDateTime(c.lastAiReply) : '—'}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{c.lastManualMessage ? formatDateTime(c.lastManualMessage) : '—'}</td>
                <td style={tdStyle}>{c.staleSkipped}</td>
                <td style={tdStyle}>{c.duplicateSkipped}</td>
                <td style={tdStyle}><StatusPill label={c.status} tone={statusTone(c.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  const renderTenants = () => (
    <SectionCard title="Tenant Readiness" subtitle="Mock data — shows GHL connection, send history, and known issues.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, minWidth: '700px' }}>
          <thead>
            <tr>
              {['Name', 'GHL', 'Location ID', 'Last Send OK', 'Last Send Fail', 'Bad Contact IDs', 'Sync', 'Status'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockTenants.map(t => (
              <tr key={t.tenantId}>
                <td style={tdStyle}>{t.name}</td>
                <td style={tdStyle}><StatusPill label={t.ghlConnection} tone={statusTone(t.ghlConnection)} /></td>
                <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{t.locationId || '—'}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{t.lastSuccessfulSend ? formatDateTime(t.lastSuccessfulSend) : '—'}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{t.lastFailedSend ? formatDateTime(t.lastFailedSend) : '—'}</td>
                <td style={tdStyle}>{t.badContactIdCount > 0 ? <StatusPill label={String(t.badContactIdCount)} tone="warn" /> : <StatusPill label="0" tone="ok" />}</td>
                <td style={tdStyle}><StatusPill label={t.syncEnabled ? 'On' : 'Off'} tone={t.syncEnabled ? 'ok' : 'neutral'} /></td>
                <td style={tdStyle}><StatusPill label={t.status} tone={statusTone(t.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  const renderErrors = () => (
    <SectionCard title="Error Tracker" subtitle="Mock data — recent errors and warnings across all sources.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, minWidth: '700px' }}>
          <thead>
            <tr>
              {['Severity', 'Source', 'Type', 'Tenant', 'Conversation', 'Message', 'Time'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockErrors.map(e => (
              <tr key={e.id}>
                <td style={tdStyle}><StatusPill label={e.severity} tone={severityTone(e.severity)} /></td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{e.source}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{e.eventType}</td>
                <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{e.tenantId?.slice(0, 8) || '—'}</td>
                <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{e.conversationId || '—'}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.message}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{formatDateTime(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  const renderAudit = () => (
    <SectionCard title="Recent Metrics / Audit Events" subtitle="Mock data — recent metrics_events rows.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, minWidth: '650px' }}>
          <thead>
            <tr>
              {['Event Type', 'Source', 'Severity', 'Tenant', 'Conversation', 'Time'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockAudit.map(e => (
              <tr key={e.id}>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{e.eventType}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{e.eventSource}</td>
                <td style={tdStyle}><StatusPill label={e.severity} tone={severityTone(e.severity)} /></td>
                <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{e.tenantId?.slice(0, 8) || '—'}</td>
                <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{e.conversationId || '—'}</td>
                <td style={{ ...tdStyle, fontSize: '0.78rem' }}>{formatDateTime(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  const renderQueues = () => (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {Object.entries(
          mockQueues.reduce((acc, q) => {
            acc['active'] = (acc['active'] || 0) + q.active;
            acc['waiting'] = (acc['waiting'] || 0) + q.waiting;
            acc['failed'] = (acc['failed'] || 0) + q.failed;
            acc['delayed'] = (acc['delayed'] || 0) + q.delayed;
            return acc;
          }, {} as Record<string, number>),
        ).map(([k, v]) => (
          <div key={k} style={kpiCardShell}>
            <p style={kpiTitle}>{k}</p>
            <p style={kpiFigure}>{v}</p>
          </div>
        ))}
      </div>
      <SectionCard title="Per-Queue Breakdown">
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Queue', 'Waiting', 'Active', 'Failed', 'Delayed', 'Retries'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockQueues.map(q => (
                <tr key={q.queue}>
                  <td style={{ ...tdStyle, fontFamily: 'inherit', fontSize: '0.78rem' }}>{q.queue}</td>
                  <td style={tdStyle}>{q.waiting}</td>
                  <td style={tdStyle}>{q.active > 0 ? <StatusPill label={`${q.active} active`} tone="ok" /> : '0'}</td>
                  <td style={tdStyle}>{q.failed > 0 ? <StatusPill label={String(q.failed)} tone="bad" /> : '0'}</td>
                  <td style={tdStyle}>{q.delayed}</td>
                  <td style={tdStyle}>{q.retryCount > 0 ? <StatusPill label={String(q.retryCount)} tone="warn" /> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );

  const renderSop = () => (
    <>
      <SectionCard title="Rollback Commands" subtitle="Placeholder commands — copy for reference. No live actions.">
        <KeyValueRows rows={[
          {
            label: 'Flag rollback',
            value: (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <code style={{ fontFamily: 'inherit', fontSize: '0.8rem', background: 'var(--aisbp-card-subtle, #f8f9fb)', padding: '0.25rem 0.5rem', borderRadius: '6px' }}>
                  sed -i &apos;s/^AISBP_..._ENABLED=true$/&...=false/&apos; /root/aisbp/.env.production
                </code>
                <button style={mvpButtonStyle} onClick={() => copySop('sed -i \'s/^AISBP_..._ENABLED=true$/AISBP_..._ENABLED=false/\' /root/aisbp/.env.production\ndocker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --no-build --force-recreate backend')}>Copy</button>
              </span>
            ),
          },
          {
            label: 'Deploy rollback',
            value: (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <code style={{ fontFamily: 'inherit', fontSize: '0.8rem', background: 'var(--aisbp-card-subtle, #f8f9fb)', padding: '0.25rem 0.5rem', borderRadius: '6px' }}>
                  git checkout stable-single-brain-tested-2026-06-26
                </code>
                <button style={mvpButtonStyle} onClick={() => copySop('cd /root/aisbp\ngit fetch origin\ngit checkout stable-single-brain-tested-2026-06-26\ndocker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --no-build --force-recreate backend')}>Copy</button>
              </span>
            ),
          },
        ]} />
      </SectionCard>
      <SectionCard title="Stable Reference">
        <KeyValueRows rows={[
          { label: 'Stable tag', value: 'stable-single-brain-tested-2026-06-26', mono: true },
          { label: 'Production URL', value: 'https://kb.aisalesbot.pro' },
          { label: 'Test contact', value: '+6588658634 (GHL: kfmh8xHdo4KFVLO43BWI)' },
          { label: 'Tenant', value: '34c62859-95b1-49a8-911c-cc44ced05452' },
          { label: 'VPS', value: 'root@72.62.243.54' },
        ]} />
      </SectionCard>
    </>
  );

  return (
    <div>
      <PageHeader title="Ops Dashboard" eyebrow="Operations Preview" />

      {/* Mock-data warning banner */}
      <div
        role="alert"
        style={{
          padding: '0.55rem 0.85rem',
          borderRadius: '6px',
          background: 'var(--aisbp-pill-warn-bg, #fffbeb)',
          color: 'var(--aisbp-pill-warn-fg, #b45309)',
          fontSize: '0.84rem',
          fontWeight: 600,
          marginBottom: '1rem',
          border: '1px solid var(--aisbp-pill-warn-border, #fde68a)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <span>Ops Dashboard Preview — mock data only, read-only, no live actions.</span>
        <button
          style={{ ...mvpButtonStyle, fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
          onClick={() => setRefreshedAt(new Date().toISOString())}
        >
          Refresh mock data
        </button>
      </div>

      {/* Tab bar */}
      <div style={tabBarStyle} role="tablist">
        {TABS.map(t => {
          const active = tab === t;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={active}
              onClick={() => { setTab(t); setSearch(''); setStatusFilter('all'); setPage(1); }}
              style={{
                border: 'none',
                background: active ? 'var(--aisbp-tenant-nav-active-bg, rgba(15, 98, 254, 0.1))' : 'transparent',
                color: active ? 'var(--aisbp-tenant-nav-active-text, #0f62fe)' : 'var(--aisbp-muted, #64748b)',
                padding: '0.5rem 0.85rem',
                borderRadius: '10px 10px 0 0',
                fontSize: '0.82rem',
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                borderBottom: active ? '2px solid var(--aisbp-tenant-nav-active-text, #0f62fe)' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Last refreshed */}
      <p style={{ fontSize: '0.72rem', color: 'var(--aisbp-muted)', margin: '-0.5rem 0 1rem' }}>
        Mock data refreshed: {formatDateTime(refreshedAt)}
      </p>

      {/* Tab content */}
      {tab === 'Health' && renderHealth()}
      {tab === 'Flags' && renderFlags()}
      {tab === 'Outbound' && renderOutbound()}
      {tab === 'GHL Sync' && renderGhlSync()}
      {tab === 'Conversations' && renderConversations()}
      {tab === 'Tenants' && renderTenants()}
      {tab === 'Errors' && renderErrors()}
      {tab === 'Audit' && renderAudit()}
      {tab === 'Queues' && renderQueues()}
      {tab === 'SOP' && renderSop()}

      {/* Detail modal */}
      {detailModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--aisbp-overlay, rgba(15, 23, 42, 0.48))',
          }}
          onClick={() => setDetailModal(null)}
        >
          <div
            style={{
              background: 'var(--aisbp-modal-bg, #fff)',
              borderRadius: '12px',
              padding: '1.5rem',
              maxWidth: '480px',
              width: '90%',
              boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
              border: '1px solid var(--aisbp-modal-border, #e2e8f0)',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1rem', color: 'var(--aisbp-text-heading, #0f172a)' }}>
              {detailModal.title}
            </h3>
            <KeyValueRows rows={detailModal.rows} />
            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <button style={mvpButtonStyle} onClick={() => setDetailModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
