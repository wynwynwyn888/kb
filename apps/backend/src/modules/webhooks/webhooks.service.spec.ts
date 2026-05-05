import { jest as jestGlobal } from '@jest/globals';

import { VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE } from '../transcription/audio-transcription.service';
import { WebhooksService } from './webhooks.service';
import { createMockSupabase, mockFrom } from '../../test/mock-supabase';

// Mock BullMQ Queue
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
      mockFrom(mockSupabase, 'tenants', null, { code: 'PGRST116' });

      const result = await service.handleGhlWebhook(makePayload());

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(false);
    });

    it('returns duplicate=true when event already exists', async () => {
      // Set up full mock chain in one mockImplementation
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'tnt_1' }, error: null }) }),
            }),
          };
        }
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: { tenant_id: 'tnt_1', status: 'CONNECTED' }, error: null }) }),
              }),
            }),
          };
        }
        if (table === 'webhook_events') {
          // Existing event found → duplicate
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: { id: 'existing_event_123' }, error: null }) }),
              }),
            }),
            insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
          };
        }
        return {};
      });

      const result = await service.handleGhlWebhook(makePayload({
        data: { id: 'msg_dup', conversationId: 'conv_1', message: 'Hi' }
      }));

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(true);
    });

    it('proceses new event and enqueues job', async () => {
      // Set up full mock chain in one mockImplementation
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'tnt_1' }, error: null }) }),
            }),
          };
        }
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: { tenant_id: 'tnt_1', status: 'CONNECTED' }, error: null }) }),
              }),
            }),
          };
        }
        if (table === 'webhook_events') {
          // No existing event (PGRST116 = no rows) → not duplicate
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
              }),
            }),
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'evt_new' }, error: null }) }) }),
          };
        }
        return {};
      });

      const result = await service.handleGhlWebhook(makePayload({
        data: { id: 'msg_new', conversationId: 'conv_1', message: 'Hello' }
      }));

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({
          locationId: 'loc_123',
          ghlConversationId: 'conv_1',
          smokeImmediate: false,
        }),
        expect.any(Object),
      );
    });

    it('enqueues persist with smokeImmediate when opts request it', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'tnt_1' }, error: null }) }),
            }),
          };
        }
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: { tenant_id: 'tnt_1', status: 'CONNECTED' }, error: null }) }),
              }),
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
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'evt_smoke' }, error: null }) }) }),
          };
        }
        return {};
      });

      await service.handleGhlWebhook(
        makePayload({ data: { id: 'msg_smoke', conversationId: 'conv_smoke', message: 'Hi' } }),
        { smokeImmediate: true },
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'persist',
        expect.objectContaining({ smokeImmediate: true }),
        expect.any(Object),
      );
    });

    it('enqueues inbound audio with attachment URL and voice transcription flag', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'tnt_1' }, error: null }) }),
            }),
          };
        }
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: { tenant_id: 'tnt_1', status: 'CONNECTED' }, error: null }) }),
              }),
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
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'evt_voice' }, error: null }) }) }),
          };
        }
        return {};
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
        }),
        expect.any(Object),
      );
    });

    it('enqueues placeholder-no-media path when unsupported body and no URL', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'tnt_1' }, error: null }) }),
            }),
          };
        }
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: { tenant_id: 'tnt_1', status: 'CONNECTED' }, error: null }) }),
              }),
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
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'evt_ph' }, error: null }) }) }),
          };
        }
        return {};
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
        }),
        expect.any(Object),
      );
    });

    it('enqueues voice transcription when unsupported placeholder but nested data.attachments has URL', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'tnt_1' }, error: null }) }),
            }),
          };
        }
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: { tenant_id: 'tnt_1', status: 'CONNECTED' }, error: null }) }),
              }),
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
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'evt_v2' }, error: null }) }) }),
          };
        }
        return {};
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
        }),
        expect.any(Object),
      );
    });

    it('does not treat customer text containing "voice note" as a GHL audio placeholder', async () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: 'tnt_1' }, error: null }) }),
            }),
          };
        }
        if (table === 'tenant_ghl_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single: async () => ({ data: { tenant_id: 'tnt_1', status: 'CONNECTED' }, error: null }) }),
              }),
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
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'evt_vn' }, error: null }) }) }),
          };
        }
        return {};
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
        }),
        expect.any(Object),
      );
    });
  });
});
