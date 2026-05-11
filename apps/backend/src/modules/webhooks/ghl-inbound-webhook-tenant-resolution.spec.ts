import { jest as jestGlobal } from '@jest/globals';
import { createMockSupabase } from '../../test/mock-supabase';
import {
  attachInboundRoutingMockImplementation,
  defaultConnectedRouting,
} from '../../test/webhook-inbound-routing-mock';
import { resolveInboundGhlWebhookTenant } from './ghl-inbound-webhook-tenant-resolution';

describe('resolveInboundGhlWebhookTenant', () => {
  const mockSupabase = createMockSupabase();

  it('returns no_match when CONNECTED row exists but bot is disabled', async () => {
    attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
      connectedMatchRows: [{ tenant_id: 't1', ghl_location_id: 'loc_1', status: 'CONNECTED' }],
      tenantByIdRow: {
        id: 't1',
        ghl_location_id: 'loc_1',
        bot_enabled: false,
        handover_paused: false,
      },
      legacyByLocationRow: null,
    });

    const r = await resolveInboundGhlWebhookTenant({
      supabase: mockSupabase,
      locationId: 'loc_1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_match');
  });

  it('returns duplicate_crm_location when two CONNECTED rows share locationId', async () => {
    attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
      connectedMatchRows: [
        { tenant_id: 'a', ghl_location_id: 'dup', status: 'CONNECTED' },
        { tenant_id: 'b', ghl_location_id: 'dup', status: 'CONNECTED' },
      ],
      tenantByIdRow: null,
      legacyByLocationRow: null,
    });

    const r = await resolveInboundGhlWebhookTenant({
      supabase: mockSupabase,
      locationId: 'dup',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('duplicate_crm_location');
  });

  it('returns connection match using defaultConnectedRouting', async () => {
    attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
      ...defaultConnectedRouting,
    });
    const r = await resolveInboundGhlWebhookTenant({
      supabase: mockSupabase,
      locationId: 'loc_123',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tenantId).toBe('tnt_1');
      expect(r.routeSource).toBe('tenant_ghl_connection');
    }
  });

  it('routes location X to workspace B only after prior workspace A connection is gone (single CONNECTED row)', async () => {
    attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
      connectedMatchRows: [
        { tenant_id: 'workspace-b', ghl_location_id: 'loc-x', status: 'CONNECTED' },
      ],
      tenantByIdRow: {
        id: 'workspace-b',
        ghl_location_id: 'loc-x',
        bot_enabled: true,
        handover_paused: false,
      },
      legacyByLocationRow: null,
    });

    const r = await resolveInboundGhlWebhookTenant({
      supabase: mockSupabase,
      locationId: 'loc-x',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tenantId).toBe('workspace-b');
      expect(r.routeSource).toBe('tenant_ghl_connection');
    }
  });
});
