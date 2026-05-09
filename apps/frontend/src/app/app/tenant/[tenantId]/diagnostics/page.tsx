'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { stripModelThinking } from '@aisbp/formatter';
import {
  getActiveHandovers,
  probeAiRouterRoute,
  type AiRouterRouteResult,
} from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  KeyValueRows,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  formatDateTime,
} from '@/components/app/mvp-ui';

type ActiveHandoverRow = {
  conversationId: string;
  ghlConversationId: string;
  contactId: string;
  channel: string;
  handoverId: string;
  handoverType: string;
  initiatedBy: string;
  note: string | null;
  createdAt: string;
};

function previewDraftReply(value: unknown): string {
  if (value === null || value === undefined) return 'None (normal for this probe)';
  if (typeof value === 'object') return JSON.stringify(value);
  return stripModelThinking(String(value));
}

export default function TenantDiagnosticsPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token, user } = useAuth();
  const isAgencyStaff = Boolean(user?.agencyRole);
  const [handovers, setHandovers] = useState<ActiveHandoverRow[] | null>(null);
  const [hLoading, setHLoading] = useState(true);
  const [hErr, setHErr] = useState('');

  const [probeConversationId, setProbeConversationId] = useState('');
  const [probeMessage, setProbeMessage] = useState('');
  const [probeChannel, setProbeChannel] = useState('WHATSAPP');
  const [probeHandoverFlag, setProbeHandoverFlag] = useState(false);
  const [probeBookingFlag, setProbeBookingFlag] = useState(false);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeErr, setProbeErr] = useState('');
  const [probeResult, setProbeResult] = useState<AiRouterRouteResult | null>(null);

  useEffect(() => {
    if (!isAgencyStaff) return;
    setProbeConversationId(
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `diag-${Date.now()}`,
    );
  }, [isAgencyStaff]);

  useEffect(() => {
    if (!isAgencyStaff) return;
    if (!token || !tenantId) return;
    let cancelled = false;

    (async () => {
      setHLoading(true);
      setHErr('');
      try {
        const h = (await getActiveHandovers(token, tenantId)) as unknown;
        const arr = Array.isArray(h) ? (h as ActiveHandoverRow[]) : [];
        if (!cancelled) setHandovers(arr);
      } catch (e) {
        if (!cancelled) {
          setHErr(e instanceof Error ? e.message : String(e));
          setHandovers(null);
        }
      } finally {
        if (!cancelled) setHLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, tenantId, isAgencyStaff]);

  async function runRoutingProbe() {
    if (!token) {
      setProbeErr('Not signed in.');
      return;
    }
    const prompt = probeMessage.trim();
    const conversationId = probeConversationId.trim();
    if (!conversationId) {
      setProbeErr('Conversation ID is required.');
      return;
    }
    if (!prompt) {
      setProbeErr('Enter a sample customer message.');
      return;
    }
    setProbeLoading(true);
    setProbeErr('');
    setProbeResult(null);
    try {
      const res = await probeAiRouterRoute(token, {
        tenantId,
        conversationId,
        prompt,
        incomingMessageType: 'text',
        channel: probeChannel.trim() || 'WHATSAPP',
        handoverRecommended: probeHandoverFlag || undefined,
        bookingIntentDetected: probeBookingFlag || undefined,
      });
      setProbeResult(res);
    } catch (e) {
      setProbeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProbeLoading(false);
    }
  }

  if (!isAgencyStaff) {
    return (
      <div>
        <PageHeader title="Diagnostics" eyebrow="Advanced" />
        <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.55, maxWidth: '42rem' }}>
          Diagnostics are available to support users only.
        </p>
        <EmptyState
          title="Support-only area"
          detail="If you need help troubleshooting routing or CRM connectivity, contact your support team."
        />
        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          <Link href={`/app/tenant/${tenantId}/control-panel`} style={{ color: '#0070f3', fontWeight: 600 }}>
            Open Control Panel →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Diagnostics" eyebrow="Advanced" />
      <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.5, maxWidth: '680px' }}>
        Support tools for troubleshooting. Routing checks are dry runs: nothing is sent to customers and they do
        not prove your full production reply path.
      </p>

      <SectionCard
        accent="muted"
        title="Routing check"
        subtitle="Same routing logic used for decisions, shown for inspection only."
      >
        <p style={{ fontSize: '0.8rem', color: '#555', marginTop: 0, marginBottom: '0.75rem' }}>
          Use a real conversation ID if you want to mirror production context, or keep the generated ID for a quick
          read. Workspace and conversation IDs are required for a full support check.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 500 }}>
            Conversation ID
            <input
              type="text"
              value={probeConversationId}
              onChange={e => setProbeConversationId(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: '0.25rem',
                padding: '0.45rem 0.5rem',
                fontSize: '0.82rem',
                fontFamily: 'inherit',
                border: '1px solid #ddd',
                borderRadius: '6px',
              }}
            />
          </label>
          <label style={{ fontSize: '0.82rem', fontWeight: 500 }}>
            Sample customer message
            <textarea
              value={probeMessage}
              onChange={e => setProbeMessage(e.target.value)}
              rows={4}
              placeholder="e.g. I want to speak to a human about my booking"
              style={{
                display: 'block',
                width: '100%',
                marginTop: '0.25rem',
                padding: '0.45rem 0.5rem',
                fontSize: '0.85rem',
                border: '1px solid #ddd',
                borderRadius: '6px',
                resize: 'vertical',
              }}
            />
          </label>
          <label style={{ fontSize: '0.82rem', fontWeight: 500 }}>
            Channel (optional, default WHATSAPP)
            <input
              type="text"
              value={probeChannel}
              onChange={e => setProbeChannel(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                maxWidth: '280px',
                marginTop: '0.25rem',
                padding: '0.45rem 0.5rem',
                fontSize: '0.82rem',
                border: '1px solid #ddd',
                borderRadius: '6px',
              }}
            />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.82rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={probeHandoverFlag}
                onChange={e => setProbeHandoverFlag(e.target.checked)}
              />
              Pretend handover is recommended
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={probeBookingFlag}
                onChange={e => setProbeBookingFlag(e.target.checked)}
              />
              Pretend booking intent detected
            </label>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void runRoutingProbe()}
          disabled={probeLoading || !token}
          style={{
            padding: '0.45rem 0.9rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            borderRadius: '6px',
            border: '1px solid #0070f3',
            background: probeLoading || !token ? '#cce4ff' : '#0070f3',
            color: '#fff',
            cursor: probeLoading || !token ? 'not-allowed' : 'pointer',
            marginBottom: '0.75rem',
          }}
        >
          {probeLoading ? 'Running probe…' : 'Run routing probe'}
        </button>
        {probeErr ? <ErrorBanner message={probeErr} /> : null}
        {probeLoading ? <LoadingBlock message="Calling AI router…" /> : null}
        {!probeLoading && probeResult ? (
          <div data-testid="routing-probe-result" style={{ marginTop: '0.25rem' }}>
            <KeyValueRows
              rows={[
                { label: 'Recommended model', value: probeResult.recommendedModel, mono: true },
                { label: 'Response mode', value: probeResult.responseMode, mono: true },
                { label: 'Confidence', value: String(probeResult.confidence) },
                { label: 'Reasoning', value: probeResult.reasoning },
                { label: 'Handover recommended', value: String(probeResult.handoverRecommended) },
                { label: 'Booking intent detected', value: String(probeResult.bookingIntentDetected) },
                {
                  label: 'Suggested tags',
                  value: Array.isArray(probeResult.tagsSuggested)
                    ? probeResult.tagsSuggested.join(', ') || '—'
                    : String(probeResult.tagsSuggested ?? '—'),
                },
                {
                  label: 'Draft reply (if any)',
                  value: previewDraftReply(probeResult.draftReply),
                },
              ]}
            />
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Active handovers"
        subtitle="Conversations where a human has been handed the thread for this workspace."
      >
        {hLoading ? <LoadingBlock message="Loading handovers…" /> : null}
        {hErr ? <ErrorBanner message={hErr} /> : null}
        {!hLoading && !hErr && handovers && handovers.length === 0 ? (
          <EmptyState title="No active handovers" detail="When a conversation is in handover, it will appear in this list." />
        ) : null}
        {!hLoading && !hErr && handovers && handovers.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {handovers.map(h => (
              <li
                key={h.handoverId}
                style={{
                  border: '1px solid #e5e5e5',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  background: '#fafafa',
                }}
              >
                <div style={{ marginBottom: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                  <StatusPill label={h.handoverType} tone="warn" />
                  <StatusPill label={h.channel} tone="neutral" />
                </div>
                <KeyValueRows
                  rows={[
                    {
                      label: 'Conversation',
                      value: (
                        <Link
                          href={`/app/tenant/${tenantId}/conversations`}
                          style={{ color: '#0070f3' }}
                        >
                          Open thread
                        </Link>
                      ),
                    },
                    { label: 'Conversation ID', value: h.conversationId, mono: true },
                    { label: 'CRM conversation ID', value: h.ghlConversationId, mono: true },
                    { label: 'Contact', value: h.contactId, mono: true },
                    { label: 'Initiated by', value: h.initiatedBy, mono: true },
                    { label: 'Started', value: formatDateTime(h.createdAt) },
                    {
                      label: 'Note',
                      value: h.note?.trim() ? h.note : '—',
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>

      <SectionCard title="Action audit" subtitle="Detailed automated action checks live under Log (better for day-to-day review).">
        <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
          The full read-only list of action intents (IDs, parameters, execution status) is kept out of this diagnostics view.
        </p>
        <Link
          href={`/app/tenant/${tenantId}/log`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.45rem 0.85rem',
            borderRadius: '8px',
            border: '1px solid var(--aisbp-border-strong, #cbd5e1)',
            background: 'var(--aisbp-surface, #fff)',
            color: 'var(--aisbp-text-heading, #0f172a)',
            fontSize: '0.85rem',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Open Log
        </Link>
      </SectionCard>
    </div>
  );
}
