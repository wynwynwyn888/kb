'use client';

import { SectionCard } from '@/components/app/mvp-ui';

export function AutomationEscalationPanel() {
  return (
    <SectionCard
      title="Human escalation"
      subtitle="Status only — deeper routing controls will ship after Tags and Booking are stable."
      accent="muted"
    >
      <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: '0 0 0.65rem' }}>
        <strong>Current capability:</strong> Basic pause-for-review is available when escalation triggers fire in conversation
        flows.
      </p>
      <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: '0 0 0.65rem' }}>
        <strong>Team notifications:</strong> Not active yet.
      </p>
      <p style={{ fontSize: '0.9rem', color: 'var(--aisbp-text-secondary)', lineHeight: 1.55, margin: 0 }}>
        Granular escalation policies and routing will be revisited in a later milestone.
      </p>
    </SectionCard>
  );
}
