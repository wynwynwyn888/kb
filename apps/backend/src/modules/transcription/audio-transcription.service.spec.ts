import { jest as jestGlobal } from '@jest/globals';

const mockFrom = jestGlobal.fn();

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({ from: mockFrom }),
}));

import { AudioTranscriptionService } from './audio-transcription.service';

describe('AudioTranscriptionService', () => {
  const service = new AudioTranscriptionService();
  const origFetch = global.fetch;
  const prevMediaHosts = process.env['MEDIA_FETCH_ALLOWED_HOSTS'];

  beforeEach(() => {
    process.env['MEDIA_FETCH_ALLOWED_HOSTS'] = 'cdn.test';
  });

  afterEach(() => {
    global.fetch = origFetch;
    jestGlobal.clearAllMocks();
    if (prevMediaHosts === undefined) delete process.env['MEDIA_FETCH_ALLOWED_HOSTS'];
    else process.env['MEDIA_FETCH_ALLOWED_HOSTS'] = prevMediaHosts;
  });

  function mockSupabaseChains() {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { agency_id: 'agency-1' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'agency_model_providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    provider: 'OPENAI',
                    api_key: 'sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                    endpoint: null,
                    settings: {},
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {} as never;
    });
  }

  it('downloads media and returns transcript', async () => {
    mockSupabaseChains();

    global.fetch = jestGlobal.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('https://cdn.test/audio')) {
        return new Response(new Uint8Array([0xff, 0xf3, 0x14, 0xc4]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      }
      if (u.includes('/audio/transcriptions')) {
        return new Response(JSON.stringify({ text: 'Book a table for two' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;

    const r = await service.transcribeRemoteMedia({
      tenantId: 'tenant-1',
      mediaUrl: 'https://cdn.test/audio/note.mp3',
      conversationId: 'conv-1',
      webhookEventId: 'evt-1',
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transcript).toBe('Book a table for two');
    }
  });

  it('returns user-facing fallback when OpenAI returns error', async () => {
    mockSupabaseChains();

    global.fetch = jestGlobal.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('https://cdn.test/bad')) {
        return new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      }
      if (u.includes('/audio/transcriptions')) {
        return new Response(JSON.stringify({ error: 'bad' }), { status: 401 });
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;

    const r = await service.transcribeRemoteMedia({
      tenantId: 'tenant-1',
      mediaUrl: 'https://cdn.test/bad/x.mp3',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.userFacingFallback).toBe(true);
    }
  });

  it('defaults transcribe model from env contract', () => {
    const prev = process.env['OPENAI_TRANSCRIBE_MODEL'];
    delete process.env['OPENAI_TRANSCRIBE_MODEL'];
    expect(service.resolveTranscribeModel()).toBe('gpt-4o-mini-transcribe');
    process.env['OPENAI_TRANSCRIBE_MODEL'] = prev;
  });
});
