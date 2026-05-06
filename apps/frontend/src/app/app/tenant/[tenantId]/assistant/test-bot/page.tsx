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
        title="Assistant Preview"
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
        Send a sample customer message to see how this assistant would respond using its current instructions, selected
        vaults, and this workspace&apos;s automation rules.
      </p>
      {token ? <BotTestPanel token={token} subaccountId={tenantId} variant="default" /> : null}
    </div>
  );
}
