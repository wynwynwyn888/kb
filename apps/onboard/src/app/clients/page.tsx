'use client';

import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { maskPhone } from '@/lib/identifiers';
import { mockClients } from '@/lib/mock-data';
import Link from 'next/link';

export default function ClientsPage() {
  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
          Clients
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--aisbp-muted, #64748b)' }}>
          All onboarded client businesses
        </p>
      </div>

      <PlaceholderCard title="Client List">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {mockClients.map(client => (
            <Link
              key={client.clientKey}
              href={`/clients/${client.clientKey}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.65rem 0.85rem',
                borderRadius: 10,
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid var(--aisbp-border, #e2e8f0)',
                background: 'var(--aisbp-surface, #fff)',
              }}
            >
              <IdentifierLabel businessName={client.displayName} clientKey={client.clientKey} />
              <StatusPill status={client.status} />
              <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>
                {maskPhone(client.contactPhone)}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--aisbp-muted, #64748b)', marginLeft: 'auto' }}>
                {client.industry}
              </span>
            </Link>
          ))}
        </div>
      </PlaceholderCard>
    </OnboardChrome>
  );
}
