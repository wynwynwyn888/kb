import { jest } from '@jest/globals';
import { resolveInboundGhlWebhookTenant } from './ghl-inbound-webhook-tenant-resolution';

describe('resolveInboundGhlWebhookTenant skipped audit', () => {
  it('returns bot_disabled with auditTenantId when bot is off', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [{ tenant_id: 't1', ghl_location_id: 'loc_1', status: 'CONNECTED' }],
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: 't1',
                      ghl_location_id: 'loc_1',
                      bot_enabled: false,
                      handover_paused: false,
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
      },
    };

    const res = await resolveInboundGhlWebhookTenant({
      supabase,
      locationId: 'loc_1',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('bot_disabled');
      expect(res.auditTenantId).toBe('t1');
    }
  });
});
