/**
 * Supabase chain mocks for WebhooksService inbound routing (tenant_ghl_connections–first resolution).
 */

export type InboundRoutingMockConfig = {
  /** Rows returned by tenant_ghl_connections for CONNECTED + ghl_location_id match (not .single()). */
  connectedMatchRows: { tenant_id: string; ghl_location_id?: string; status?: string }[];
  /** tenants row loaded by id after a single connection match (null → PGRST116). */
  tenantByIdRow: {
    id: string;
    ghl_location_id?: string | null;
    bot_enabled?: boolean;
    handover_paused?: boolean;
  } | null;
  /** tenants row for legacy tenants.ghl_location_id fallback. */
  legacyByLocationRow: {
    id: string;
    ghl_location_id?: string | null;
    bot_enabled?: boolean;
    handover_paused?: boolean;
  } | null;
  /** When true, findExistingEvent returns an existing row (duplicate webhook). */
  duplicateEvent?: boolean;
  /** Inserted webhook event id when not duplicate. */
  newEventId?: string;
};

export function attachInboundRoutingMockImplementation(
  fromMock: jest.Mock,
  config: InboundRoutingMockConfig,
): void {
  const newEvtId = config.newEventId ?? 'evt_new';
  fromMock.mockImplementation((table: string) => {
    if (table === 'tenant_ghl_connections') {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: config.connectedMatchRows, error: null }),
          }),
        }),
      };
    }
    if (table === 'tenants') {
      return {
        select: () => ({
          eq: (col: string) => {
            if (col === 'id') {
              return {
                single: async () => ({
                  data: config.tenantByIdRow,
                  error: config.tenantByIdRow ? null : { code: 'PGRST116' },
                }),
              };
            }
            if (col === 'ghl_location_id') {
              return {
                maybeSingle: async () => ({
                  data: config.legacyByLocationRow,
                  error: null,
                }),
              };
            }
            return { single: async () => ({ data: null, error: { code: 'PGRST116' } }) };
          },
        }),
      };
    }
    if (table === 'webhook_events') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () =>
                config.duplicateEvent
                  ? { data: { id: 'existing_event_123' }, error: null }
                  : { data: null, error: { code: 'PGRST116' } },
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: newEvtId }, error: null }),
          }),
        }),
      };
    }
    return {};
  });
}

export const defaultConnectedRouting: InboundRoutingMockConfig = {
  connectedMatchRows: [{ tenant_id: 'tnt_1', ghl_location_id: 'loc_123', status: 'CONNECTED' }],
  tenantByIdRow: {
    id: 'tnt_1',
    ghl_location_id: 'loc_123',
    bot_enabled: true,
    handover_paused: false,
  },
  legacyByLocationRow: null,
};
