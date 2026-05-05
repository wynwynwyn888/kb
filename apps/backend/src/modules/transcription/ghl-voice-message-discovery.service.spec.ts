import { jest as jestGlobal } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { GhlVoiceMessageDiscoveryService } from './ghl-voice-message-discovery.service';

const mockSupabase = {
  from: jestGlobal.fn(),
};

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockSupabase,
}));

jestGlobal.mock('../../lib/encryption', () => ({
  decrypt: () => 'plain_token',
}));

function connectedTokenRow() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: { private_token_encrypted: 'enc' }, error: null }),
          }),
        }),
      }),
    }),
  };
}

describe('GhlVoiceMessageDiscoveryService', () => {
  let svc: GhlVoiceMessageDiscoveryService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    process.env['GHL_VOICE_DISCOVER_DELAY_MS'] = '0';
    process.env['GHL_VOICE_DISCOVER_MAX_ATTEMPTS'] = '1';
    mockSupabase.from.mockImplementation(() => connectedTokenRow());
    svc = new GhlVoiceMessageDiscoveryService();
  });

  it('finds candidate from data.messages shape', async () => {
    global.fetch = jestGlobal.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          data: {
            messages: [{ id: 'm1', direction: 'inbound', body: '>AUDIO<', dateAdded: '2026-01-01T00:00:00Z' }],
          },
        }),
      }) as never,
    );
    const res = await svc.discoverVoicePlaceholderMessageId({
      tenantId: 't1',
      locationId: 'loc1',
      conversationId: 'conv1',
      webhookTimestampIso: '2026-01-01T00:00:03Z',
      placeholderKind: 'AUDIO',
    });
    expect(res).toEqual(expect.objectContaining({ ok: true, messageId: 'm1' }));
  });

  it('finds candidate from data.conversation.messages shape', async () => {
    global.fetch = jestGlobal.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          data: {
            conversation: {
              messages: [{ id: 'm2', direction: 'inbound', body: '<VOICE>', dateAdded: '2026-01-01T00:00:00Z' }],
            },
          },
        }),
      }) as never,
    );
    const res = await svc.discoverVoicePlaceholderMessageId({
      tenantId: 't1',
      locationId: 'loc1',
      conversationId: 'conv1',
      webhookTimestampIso: '2026-01-01T00:00:03Z',
      placeholderKind: 'VOICE',
    });
    expect(res).toEqual(expect.objectContaining({ ok: true, messageId: 'm2' }));
  });

  it('extracts id from messageId field', async () => {
    global.fetch = jestGlobal.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          items: [{ messageId: 'mx1', direction: 'inbound', body: 'AUDIO', dateAdded: '2026-01-01T00:00:00Z' }],
        }),
      }) as never,
    );
    const res = await svc.discoverVoicePlaceholderMessageId({
      tenantId: 't1',
      locationId: 'loc1',
      conversationId: 'conv1',
      webhookTimestampIso: '2026-01-01T00:00:03Z',
      placeholderKind: 'AUDIO',
    });
    expect(res).toEqual(expect.objectContaining({ ok: true, messageId: 'mx1' }));
  });

  it('extracts body from nested message.body', async () => {
    global.fetch = jestGlobal.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          results: [{ id: 'm3', direction: 'inbound', message: { body: 'AUDIO' }, dateAdded: '2026-01-01T00:00:00Z' }],
        }),
      }) as never,
    );
    const res = await svc.discoverVoicePlaceholderMessageId({
      tenantId: 't1',
      locationId: 'loc1',
      conversationId: 'conv1',
      webhookTimestampIso: '2026-01-01T00:00:03Z',
      placeholderKind: 'AUDIO',
    });
    expect(res).toEqual(expect.objectContaining({ ok: true, messageId: 'm3' }));
  });

  it('matches type AudioMessage even with empty body', async () => {
    global.fetch = jestGlobal.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          messages: [{ id: 'm4', direction: 'inbound', messageType: 'AudioMessage', body: '', dateAdded: '2026-01-01T00:00:00Z' }],
        }),
      }) as never,
    );
    const res = await svc.discoverVoicePlaceholderMessageId({
      tenantId: 't1',
      locationId: 'loc1',
      conversationId: 'conv1',
      webhookTimestampIso: '2026-01-01T00:00:03Z',
      placeholderKind: 'AUDIO',
    });
    expect(res).toEqual(expect.objectContaining({ ok: true, messageId: 'm4' }));
  });

  it('matches attachment audio URL candidate', async () => {
    global.fetch = jestGlobal.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          messages: [
            {
              id: 'm5',
              direction: 'inbound',
              body: 'unsupported',
              attachments: [{ url: 'https://cdn.example.com/voice.ogg' }],
              dateAdded: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      }) as never,
    );
    const res = await svc.discoverVoicePlaceholderMessageId({
      tenantId: 't1',
      locationId: 'loc1',
      conversationId: 'conv1',
      webhookTimestampIso: '2026-01-01T00:00:03Z',
      placeholderKind: 'AUDIO',
    });
    expect(res).toEqual(expect.objectContaining({ ok: true, messageId: 'm5' }));
  });

  it('logs safe samples when no candidate found', async () => {
    const logSpy = jestGlobal.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const warnSpy = jestGlobal.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    global.fetch = jestGlobal.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          messages: [
            { id: 'x1', direction: 'inbound', body: 'hello', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'x2', direction: 'outbound', body: 'bye', createdAt: '2026-01-01T00:00:01Z' },
          ],
        }),
      }) as never,
    );
    const res = await svc.discoverVoicePlaceholderMessageId({
      tenantId: 't1',
      locationId: 'loc1',
      conversationId: 'conv1',
      webhookTimestampIso: '2026-01-01T00:00:03Z',
      placeholderKind: 'AUDIO',
    });
    expect(res).toEqual(expect.objectContaining({ ok: false, reason: 'message_id_not_found' }));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"detectedCollectionPath":"messages"'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"latestMessageSamples"'));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"voiceMessageDiscoveryNoAudioCandidateButRecentInbound":true'),
    );
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

