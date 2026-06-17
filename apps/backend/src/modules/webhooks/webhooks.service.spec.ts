import { jest as jestGlobal } from '@jest/globals';

import { VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE } from '../transcription/audio-transcription.service';
import { WebhooksService } from './webhooks.service';
import { createMockSupabase } from '../../test/mock-supabase';
import {
  attachInboundRoutingMockImplementation,
  defaultConnectedRouting,
} from '../../test/webhook-inbound-routing-mock';

jestGlobal.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => jestGlobal.fn(),
  Queue: jestGlobal.fn(() => ({
    add: jestGlobal.fn(async () => {}),
  })) as never,
}));

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
  safeLog: (obj: unknown) => JSON.stringify(obj),
}));

function makePayload(overrides: {
  locationId?: string;
  event?: string;
  data?: { id?: string; conversationId?: string; contactId?: string; message?: string; messageType?: string };
  timestamp?: string;
} = {}) {
  return {
    locationId: overrides.locationId ?? 'loc_123',
    event: overrides.event ?? 'conversation_message_created',
    data: overrides.data ?? { id: 'msg_abc', conversationId: 'conv_123', message: 'Hello' },
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:00Z',
  };
}

describe('WebhooksService', () => {
  let service: WebhooksService;
  const mockQueue = { add: jestGlobal.fn(async () => {}) };

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    service = new WebhooksService(mockQueue as never);
  });

  describe('extractDedupeKey (via handleGhlWebhook behavior)', () => {
    it('returns success+skip for unregistered location', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        connectedMatchRows: [],
        tenantByIdRow: null,
        legacyByLocationRow: null,
      });

      const result = await service.handleGhlWebhook(makePayload());

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('returns duplicate=true when event already exists', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        duplicateEvent: true,
      });

      const result = await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_dup', conversationId: 'conv_1', message: 'Hi' } }),
      );

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(true);
    });

    it('proceses new event and enqueues job', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
      });

      const result = await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_new', conversationId: 'conv_1', message: 'Hello' } }),
      );

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({
          locationId: 'loc_123',
          ghlConversationId: 'conv_1',
          smokeImmediate: false,
          resolvedTenantId: 'tnt_1',
        }),
        expect.any(Object),
      );
    });

    it('enqueues persist with smokeImmediate when opts request it', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        newEventId: 'evt_smoke',
      });

      await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_smoke', conversationId: 'conv_smoke', message: 'Hi' } }),
        { smokeImmediate: true },
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({ smokeImmediate: true, resolvedTenantId: 'tnt_1' }),
        expect.any(Object),
      );
    });

    it('enqueues inbound audio with attachment URL and voice transcription flag', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        newEventId: 'evt_voice',
      });

      await service.handleGhlWebhook(
        makePayload({
          data: {
            id: 'msg_voice',
            conversationId: 'conv_1',
            contactId: 'c1',
            message: '',
            messageType: 'audio',
            attachments: [{ url: 'https://cdn.example.com/inbound.m4a', contentType: 'audio/mp4' }],
          } as never,
        }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({
          messageType: 'audio',
          audioMediaUrl: 'https://cdn.example.com/inbound.m4a',
          voiceInboundNeedsTranscribe: true,
          resolvedTenantId: 'tnt_1',
        }),
        expect.any(Object),
      );
    });

    it('enqueues placeholder-no-media path when unsupported body and no URL', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        newEventId: 'evt_ph',
      });

      await service.handleGhlWebhook(
        makePayload({
          data: {
            id: 'msg_ph',
            conversationId: 'conv_1',
            contactId: 'c1',
            message: 'This Message type is not supported',
            messageType: 'text',
          } as never,
        }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({
          messageType: 'text',
          messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
          voiceInboundNeedsTranscribe: false,
          voiceInboundAudioPlaceholderWithoutMediaUrl: true,
          audioMediaUrl: undefined,
          resolvedTenantId: 'tnt_1',
        }),
        expect.any(Object),
      );
    });

    it('enqueues voice transcription when unsupported placeholder but nested data.attachments has URL', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        newEventId: 'evt_v2',
      });

      await service.handleGhlWebhook(
        makePayload({
          data: {
            id: 'msg_v2',
            conversationId: 'conv_1',
            contactId: 'c1',
            message: 'This Message type is not supported',
            messageType: 'text',
            data: {
              attachments: [{ url: 'https://cdn.example.com/hidden.m4a', contentType: 'audio/mp4' }],
            },
          } as never,
        }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({
          messageType: 'text',
          messageContent: 'This Message type is not supported',
          audioMediaUrl: 'https://cdn.example.com/hidden.m4a',
          voiceInboundNeedsTranscribe: true,
          voiceInboundAudioPlaceholderWithoutMediaUrl: false,
          resolvedTenantId: 'tnt_1',
        }),
        expect.any(Object),
      );
    });

    it('does not treat customer text containing "voice note" as a GHL audio placeholder', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        newEventId: 'evt_vn',
      });

      const prose = 'If you get stuck, you can always send a voice note and we will help.';
      await service.handleGhlWebhook(
        makePayload({
          data: {
            id: 'msg_vn',
            conversationId: 'conv_1',
            contactId: 'c1',
            message: prose,
            messageType: 'text',
          } as never,
        }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({
          messageContent: prose,
          voiceInboundAudioPlaceholderWithoutMediaUrl: false,
          resolvedTenantId: 'tnt_1',
        }),
        expect.any(Object),
      );
    });

    it('routes by tenant_ghl_connections when tenants.ghl_location_id is null (legacy mirror drift)', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        tenantByIdRow: {
          id: 'tnt_1',
          ghl_location_id: null,
          bot_enabled: true,
          handover_paused: false,
        },
      });

      await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_m1', conversationId: 'conv_1', message: 'Hi' } }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({ resolvedTenantId: 'tnt_1' }),
        expect.any(Object),
      );
    });

    it('enqueues persist to workspace B when only B has CONNECTED for location (post-transfer same GHL location)', async () => {
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

      const result = await service.handleGhlWebhook(
        makePayload({
          locationId: 'loc-x',
          data: { id: 'msg_xfer', conversationId: 'conv_xfer', message: 'Hi' },
        }),
      );

      expect(result.success).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({
          locationId: 'loc-x',
          ghlConversationId: 'conv_xfer',
          resolvedTenantId: 'workspace-b',
        }),
        expect.any(Object),
      );
    });

    it('logs CRM location drift when tenants.ghl_location_id differs from connection location', async () => {
      const warnSpy = jestGlobal.spyOn(service['logger'], 'warn');
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        tenantByIdRow: {
          id: 'tnt_1',
          ghl_location_id: 'legacy-loc-old',
          bot_enabled: true,
          handover_paused: false,
        },
      });

      await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_drift', conversationId: 'conv_1', message: 'Hi' } }),
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('CRM location drift tenantId=tnt_1'),
      );
      warnSpy.mockRestore();
    });

    it('uses tenant_legacy_location_match when no CONNECTED connection row but legacy tenant matches', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        connectedMatchRows: [],
        tenantByIdRow: null,
        legacyByLocationRow: {
          id: 'tnt_legacy',
          ghl_location_id: 'loc_123',
          bot_enabled: true,
          handover_paused: false,
        },
      });

      await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_leg', conversationId: 'conv_1', message: 'Hi' } }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({ resolvedTenantId: 'tnt_legacy' }),
        expect.any(Object),
      );
    });

    it('fails closed on duplicate CONNECTED connections for same locationId (no enqueue)', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        connectedMatchRows: [
          { tenant_id: 'tnt_a', ghl_location_id: 'loc_123', status: 'CONNECTED' },
          { tenant_id: 'tnt_b', ghl_location_id: 'loc_123', status: 'CONNECTED' },
        ],
        tenantByIdRow: null,
        legacyByLocationRow: null,
      });

      const result = await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_dup_loc', conversationId: 'conv_1', message: 'Hi' } }),
      );

      expect(result.success).toBe(true);
      expect(result.skippedReason).toBe('duplicate_crm_location');
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('allows agency-style tenant when connection + bot flags qualify', async () => {
      attachInboundRoutingMockImplementation(mockSupabase.from as jest.Mock, {
        ...defaultConnectedRouting,
        tenantByIdRow: {
          id: 'tnt_agency',
          ghl_location_id: 'loc_123',
          bot_enabled: true,
          handover_paused: false,
        },
      });

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ tenant_id: 'tnt_agency', ghl_location_id: 'loc_123', status: 'CONNECTED' }],
                  error: null,
                }),
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
                      data: {
                        id: 'tnt_agency',
                        ghl_location_id: 'loc_123',
                        bot_enabled: true,
                        handover_paused: false,
                        is_agency_workspace: true,
                      },
                      error: null,
                    }),
                  };
                }
                if (col === 'ghl_location_id') {
                  return { maybeSingle: async () => ({ data: null, error: null }) };
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
                eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
              }),
            }),
            insert: () => ({
              select: () => ({ single: async () => ({ data: { id: 'evt_ag' }, error: null }) }),
            }),
          };
        }
        return {};
      });

      await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_ag', conversationId: 'conv_1', message: 'Lead' } }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({ resolvedTenantId: 'tnt_agency' }),
        expect.any(Object),
      );
    });
  });

  describe('skipped routing audit', () => {
    it('persists SKIPPED webhook event when bot is disabled', async () => {
      const skippedInserts: unknown[] = [];
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ tenant_id: 'tnt_off', ghl_location_id: 'loc_123', status: 'CONNECTED' }],
                  error: null,
                }),
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
                      data: {
                        id: 'tnt_off',
                        ghl_location_id: 'loc_123',
                        bot_enabled: false,
                        handover_paused: false,
                      },
                      error: null,
                    }),
                  };
                }
                return { maybeSingle: async () => ({ data: null, error: null }) };
              },
            }),
          };
        }
        if (table === 'webhook_events') {
          return {
            insert: (row: unknown) => {
              skippedInserts.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        return {};
      });

      const result = await service.handleGhlWebhook(makePayload());

      expect(result.success).toBe(true);
      expect(result.skippedReason).toBe('bot_disabled');
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(skippedInserts).toHaveLength(1);
      expect(skippedInserts[0]).toEqual(
        expect.objectContaining({
          tenant_id: 'tnt_off',
          processing_status: 'SKIPPED',
          processing_error: 'bot_disabled',
        }),
      );
    });
  });
});
