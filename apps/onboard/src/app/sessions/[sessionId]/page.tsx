'use client';

import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { mockAgentSession } from '@/lib/mock-data';
import { useParams } from 'next/navigation';

export default function SessionDetailPage() {
  const params = useParams<{ sessionId: string }>();

  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          Agent Session
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
          <StatusPill status={mockAgentSession.status} />
          <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>
            Session: {params.sessionId ? params.sessionId.slice(0, 8) : mockAgentSession.sessionId.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Session overview */}
      <PlaceholderCard title={`Project: ${mockAgentSession.displayName} · ${mockAgentSession.clientKey}`}>
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Progress:</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#E2E8F0', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(mockAgentSession.completedSteps / mockAgentSession.totalSteps) * 100}%`,
                  height: '100%', borderRadius: 4, background: '#2563EB',
                }}
              />
            </div>
            <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)', minWidth: 60, textAlign: 'right' }}>
              {mockAgentSession.completedSteps}/{mockAgentSession.totalSteps} steps
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.82rem' }}>
            <div>
              <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>Current step: </span>
              <span style={{ fontWeight: 600 }}>{mockAgentSession.currentStep}</span>
            </div>
            <div>
              <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>Expires: </span>
              <span>{new Date(mockAgentSession.expiresAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </PlaceholderCard>

      {/* Recent answers */}
      <PlaceholderCard title="Recent Answers">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {mockAgentSession.recentAnswers.map((answer, i) => (
            <div
              key={i}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 8,
                border: '1px solid var(--aisbp-border, #e2e8f0)',
                background: 'var(--aisbp-surface, #fff)',
              }}
            >
              <div style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', marginBottom: '0.15rem' }}>
                {answer.questionKey.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--aisbp-text, #0f172a)' }}>
                &quot;{answer.answerValue}&quot;
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--aisbp-muted, #64748b)', marginTop: '0.2rem' }}>
                Confidence: {(answer.confidence * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </PlaceholderCard>
    </OnboardChrome>
  );
}
