'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { BotTestPanel } from '@/components/app/bot-test/BotTestPanel';
import { PageHeader } from '@/components/app/mvp-ui';

export default function TenantAssistantTestBotPage() {
  const params = useParams();
  const tenantId = params['tenantId'] as string;
  const { token } = useAuth();

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <PageHeader
        title="Test Bot"
        eyebrow="Assistant"
      />
      <p
        style={{
          fontSize: '0.875rem',
          color: 'var(--aisbp-muted, #64748b)',
          margin: '0 0 1.25rem',
          maxWidth: '40rem',
          lineHeight: 1.55,
        }}
      >
        Try the <strong>active</strong> assistant profile: persona, goals, business notes, selected vaults, automation,
        booking, handover, and follow-up behaviour match what customers see (within sandbox limits).
      </p>
      {token ? <BotTestPanel token={token} subaccountId={tenantId} variant="default" /> : null}
    </div>
  );
}
