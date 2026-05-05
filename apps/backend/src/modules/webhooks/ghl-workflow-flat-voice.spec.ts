import { jest as jestGlobal } from '@jest/globals';

import { coerceGhlWebhookPayload } from './ghl-webhook-payload-shape';
import {
  extractGhlInboundAudioMediaUrl,
  ghlBodyIndicatesAudioPlaceholder,
  ghlInboundShouldTranscribeVoice,
} from './ghl-inbound-audio-media';
import { VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE } from '../transcription/audio-transcription.service';
import { WebhooksService } from './webhooks.service';
import { createMockSupabase } from '../../test/mock-supabase';

jestGlobal.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => jestGlobal.fn(),
  Queue: jestGlobal.fn(() => ({
    add: jestGlobal.fn(async () => {}),
  })) as never,
}));

const mockSupabase = createMockSupabase();
jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

function baseFlatWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    locationId: 'loc_123',
    event: 'InboundMessage',
    timestamp: '2026-05-05T10:00:00.000Z',
    customData: {
      id: 'wf_msg_1',
      conversationId: 'conv_wf',
      contactId: 'ct_wf',
      message: 'hello',
      messageType: 'text',
      ...overrides,
    },
    ...overrides,
  };
}

describe('GHL workflow-flat InboundMessage + voice URL extraction', () => {
  it('coerce merges top-level mediaUrl into canonical data', () => {
    const raw = {
      ...baseFlatWorkflow(),
      mediaUrl: 'https://cdn.example.com/top-level.m4a',
    };
    const { payload, shape, workflowFlatRaw } = coerceGhlWebhookPayload(raw);
    expect(shape).toBe('ghl_workflow_flat');
    expect(workflowFlatRaw).toBeDefined();
    const d = payload.data as unknown as Record<string, unknown>;
    expect(d['mediaUrl']).toBe('https://cdn.example.com/top-level.m4a');
  });

  it('coerce merges customData.mediaUrl into canonical data', () => {
    const raw = baseFlatWorkflow({ mediaUrl: 'https://cdn.example.com/custom.m4a' });
    const { payload, shape } = coerceGhlWebhookPayload(raw);
    expect(shape).toBe('ghl_workflow_flat');
    const d = payload.data as unknown as Record<string, unknown>;
    expect(d['mediaUrl']).toBe('https://cdn.example.com/custom.m4a');
  });

  it('coerce merges customData.attachments[0].url into canonical data', () => {
    const raw = baseFlatWorkflow({
      attachments: [{ url: 'https://cdn.example.com/att.ogg', contentType: 'audio/ogg' }],
    });
    const { payload, shape } = coerceGhlWebhookPayload(raw);
    expect(shape).toBe('ghl_workflow_flat');
    const d = payload.data as unknown as Record<string, unknown>;
    expect(d['attachments']).toEqual([
      { url: 'https://cdn.example.com/att.ogg', contentType: 'audio/ogg' },
    ]);
  });

  it('extractGhlInboundAudioMediaUrl reads workflowFlatRaw top-level mediaUrl when data lacks it', () => {
    const url = extractGhlInboundAudioMediaUrl(
      { message: 'hi', messageType: 'text' } as Record<string, unknown>,
      {
        workflowFlatRaw: { mediaUrl: 'https://cdn.example.com/only-on-flat.m4a' } as Record<string, unknown>,
      },
    );
    expect(url).toBe('https://cdn.example.com/only-on-flat.m4a');
  });

  it('extractGhlInboundAudioMediaUrl reads customData.mediaUrl via workflowFlatRaw', () => {
    const url = extractGhlInboundAudioMediaUrl(
      {},
      {
        workflowFlatRaw: {
          customData: { mediaUrl: 'https://cdn.example.com/cd-media.webm' },
        } as Record<string, unknown>,
      },
    );
    expect(url).toBe('https://cdn.example.com/cd-media.webm');
  });

  it('extractGhlInboundAudioMediaUrl reads customData.attachments[0].url via workflowFlatRaw', () => {
    const url = extractGhlInboundAudioMediaUrl(
      {},
      {
        workflowFlatRaw: {
          customData: {
            attachments: [{ url: 'https://cdn.example.com/cd-att.mp3' }],
          },
        } as Record<string, unknown>,
      },
    );
    expect(url).toBe('https://cdn.example.com/cd-att.mp3');
  });

  it('placeholder without media: coerce + extract yields no URL and body matches placeholder', () => {
    const raw = baseFlatWorkflow({
      message: 'This Message type is not supported',
    });
    const { payload, workflowFlatRaw } = coerceGhlWebhookPayload(raw);
    const data = payload.data as unknown as Record<string, unknown>;
    const body = String(data['message'] ?? '');
    const audio = extractGhlInboundAudioMediaUrl(data, {
      envelope: payload as unknown as Record<string, unknown>,
      workflowFlatRaw,
    });
    expect(audio).toBeNull();
    expect(ghlBodyIndicatesAudioPlaceholder(body)).toBe(true);
  });

  it('placeholder with media URL: should transcribe', () => {
    const raw = baseFlatWorkflow({
      message: 'This Message type is not supported',
      mediaUrl: 'https://cdn.example.com/v.m4a',
    });
    const { payload, workflowFlatRaw } = coerceGhlWebhookPayload(raw);
    const data = payload.data as unknown as Record<string, unknown>;
    const audio = extractGhlInboundAudioMediaUrl(data, {
      envelope: payload as unknown as Record<string, unknown>,
      workflowFlatRaw,
    });
    expect(audio).toBe('https://cdn.example.com/v.m4a');
    expect(
      ghlInboundShouldTranscribeVoice({
        messageType: 'text',
        messageContent: String(data['message']),
        audioMediaUrl: audio,
        rawData: data,
        envelope: payload as unknown as Record<string, unknown>,
        workflowFlatRaw,
      }),
    ).toBe(true);
  });
});

describe('WebhooksService + workflowFlatRaw enqueue', () => {
  const mockQueue = { add: jestGlobal.fn(async () => {}) };

  beforeEach(() => {
    jestGlobal.clearAllMocks();
  });

  it('enqueues InboundMessage with merged mediaUrl and transcription flag', async () => {
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
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'evt_wf' }, error: null }) }) }),
        };
      }
      return {};
    });

    const raw = baseFlatWorkflow({
      message: '',
      messageType: 'text',
      mediaUrl: 'https://cdn.example.com/inbound-wf.m4a',
    });
    const { payload, workflowFlatRaw } = coerceGhlWebhookPayload(raw);

    const service = new WebhooksService(mockQueue as never);
    await service.handleGhlWebhook(payload, { workflowFlatRaw });

    expect(mockQueue.add).toHaveBeenCalledWith(
      'persist',
      expect.objectContaining({
        messageType: 'text',
        audioMediaUrl: 'https://cdn.example.com/inbound-wf.m4a',
        voiceInboundNeedsTranscribe: true,
      }),
      expect.any(Object),
    );
  });

  it('enqueues InboundMessage placeholder-no-media when only unsupported text in customData', async () => {
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
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'evt_ph2' }, error: null }) }) }),
        };
      }
      return {};
    });

    const raw = baseFlatWorkflow({
      message: 'unsupported message',
    });
    const { payload, workflowFlatRaw } = coerceGhlWebhookPayload(raw);

    const service = new WebhooksService(mockQueue as never);
    await service.handleGhlWebhook(payload, { workflowFlatRaw });

    expect(mockQueue.add).toHaveBeenCalledWith(
      'persist',
      expect.objectContaining({
        messageContent: VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
        voiceInboundNeedsTranscribe: false,
        voiceInboundAudioPlaceholderWithoutMediaUrl: true,
      }),
      expect.any(Object),
    );
  });
});
