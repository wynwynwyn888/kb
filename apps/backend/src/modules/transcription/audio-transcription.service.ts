import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { isUsableOpenAiFallbackKey } from '../../lib/ai-live-model-resolve';

export const VOICE_NOTE_TRANSCRIPTION_FAILED_USER_MESSAGE =
  "I couldn't read the voice note clearly. Could you send it again or type the key point?";

/** Persisted inbound text when GHL sends an audio/voice placeholder but no downloadable media URL. */
export const VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE =
  "I received your audio message, but I couldn't access the audio file. Could you please type your request or resend it as text?";

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

function transcribeModelFromEnv(): string {
  return process.env['OPENAI_TRANSCRIBE_MODEL']?.trim() || 'gpt-4o-mini-transcribe';
}

function safeUrlMeta(mediaUrl: string): { host: string; pathLen: number } {
  try {
    const u = new URL(mediaUrl);
    return { host: u.hostname, pathLen: u.pathname.length };
  } catch {
    return { host: 'invalid', pathLen: 0 };
  }
}

export function inferAudioFilenameFromMime(contentType: string | null): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'audio.mp3';
  if (ct.includes('mp4') || ct.includes('m4a')) return 'audio.m4a';
  if (ct.includes('webm')) return 'audio.webm';
  if (ct.includes('ogg')) return 'audio.ogg';
  if (ct.includes('wav')) return 'audio.wav';
  return 'audio.bin';
}

function inferFilename(mediaUrl: string, contentType: string | null): string {
  try {
    const base = new URL(mediaUrl).pathname.split('/').pop();
    if (base && /\.[a-z0-9]{2,4}$/i.test(base)) return base.slice(0, 200);
  } catch {
    /* ignore */
  }
  return inferAudioFilenameFromMime(contentType);
}

type ProviderRow = {
  provider: string;
  api_key: string;
  endpoint: string | null;
  settings: Record<string, unknown>;
};

@Injectable()
export class AudioTranscriptionService {
  private readonly logger = new Logger(AudioTranscriptionService.name);
  private readonly supabase = getSupabaseService();

  /** Exposed for tests / diagnostics only. */
  resolveTranscribeModel(): string {
    return transcribeModelFromEnv();
  }

  private async getAgencyId(tenantId: string): Promise<string | null> {
    const { data, error } = await this.supabase.from('tenants').select('agency_id').eq('id', tenantId).single();
    if (error) {
      this.logger.warn(`audioTranscription tenant=${tenantId} agency_lookup=${formatPostgrestError(error)}`);
      return null;
    }
    return (data as { agency_id?: string } | null)?.agency_id ?? null;
  }

  private async downloadAudio(mediaUrl: string): Promise<{ buffer: Buffer; contentType: string | null }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(mediaUrl, { redirect: 'follow', signal: ac.signal });
      if (!res.ok) {
        throw new Error(`http_${res.status}`);
      }
      const contentType = res.headers.get('content-type');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_DOWNLOAD_BYTES) {
        throw new Error('too_large');
      }
      return { buffer: buf, contentType };
    } finally {
      clearTimeout(timer);
    }
  }

  private async callOpenAiTranscription(params: {
    apiKey: string;
    endpoint: string | null;
    buffer: Buffer;
    filename: string;
    mimeHint: string | null;
  }): Promise<string> {
    const base = (params.endpoint?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${base}/audio/transcriptions`;
    const model = transcribeModelFromEnv();

    const bytes = new Uint8Array(params.buffer);
    const blob = new Blob([bytes], {
      type: params.mimeHint && params.mimeHint.trim() ? params.mimeHint : 'application/octet-stream',
    });
    const form = new FormData();
    form.append('file', blob, params.filename);
    form.append('model', model);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: form,
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`openai_${res.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as { text?: string };
    } catch {
      throw new Error('openai_bad_json');
    }
    const text = typeof (parsed as { text?: unknown }).text === 'string' ? (parsed as { text: string }).text.trim() : '';
    if (!text) {
      throw new Error('empty_transcript');
    }
    return text;
  }

  /**
   * Downloads inbound audio and transcribes via OpenAI speech-to-text.
   * Never logs raw transcript or full media URL (may contain signed query params).
   */
  async transcribeRemoteMedia(params: {
    tenantId: string;
    mediaUrl: string;
    conversationId?: string;
    webhookEventId?: string;
  }): Promise<
    | { ok: true; transcript: string; mediaBytes: number; contentType: string | null }
    | { ok: false; errorCode: string; userFacingFallback: true }
  > {
    const mediaUrl = params.mediaUrl.trim();
    const { host, pathLen } = safeUrlMeta(mediaUrl);
    const model = transcribeModelFromEnv();

    this.logger.log(
      `audioTranscriptionStarted ${JSON.stringify({
        tenantId: params.tenantId,
        conversationId: params.conversationId ?? null,
        webhookEventId: params.webhookEventId ?? null,
        mediaHost: host,
        mediaPathLen: pathLen,
        model,
      })}`,
    );

    let mediaBytes = 0;
    let contentType: string | null = null;

    try {
      const agencyId = await this.getAgencyId(params.tenantId);
      if (!agencyId) {
        throw new Error('no_agency');
      }
      const { data: row, error: rowErr } = await this.supabase
        .from('agency_model_providers')
        .select('provider, api_key, endpoint, settings')
        .eq('agency_id', agencyId)
        .eq('provider', 'OPENAI')
        .maybeSingle();
      if (rowErr || !row) {
        throw new Error('no_openai_row');
      }
      const pr = row as ProviderRow;
      const apiKey = pr.api_key?.trim() ?? '';
      if (!isUsableOpenAiFallbackKey(apiKey)) {
        throw new Error('no_api_key');
      }

      const dl = await this.downloadAudio(mediaUrl);
      mediaBytes = dl.buffer.length;
      contentType = dl.contentType;
      const filename = inferFilename(mediaUrl, dl.contentType);

      const transcript = await this.callOpenAiTranscription({
        apiKey,
        endpoint: pr.endpoint,
        buffer: dl.buffer,
        filename,
        mimeHint: dl.contentType,
      });

      this.logger.log(
        `audioTranscriptionSucceeded ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId ?? null,
          webhookEventId: params.webhookEventId ?? null,
          transcriptCharCount: transcript.length,
          mediaBytes,
        })}`,
      );

      return { ok: true, transcript, mediaBytes, contentType };
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown';
      this.logger.warn(
        `audioTranscriptionFailed ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId ?? null,
          webhookEventId: params.webhookEventId ?? null,
          errorCode: code,
          mediaBytes,
        })}`,
      );
      return { ok: false, errorCode: code, userFacingFallback: true };
    }
  }

  /**
   * Transcribe an in-memory audio buffer (e.g. GHL recording API). Same privacy rules as URL path.
   */
  async transcribeAudioBuffer(params: {
    tenantId: string;
    buffer: Buffer;
    contentType: string | null;
    conversationId?: string;
    webhookEventId?: string;
    sourceLabel?: string;
  }): Promise<
    | { ok: true; transcript: string; mediaBytes: number; contentType: string | null }
    | { ok: false; errorCode: string; userFacingFallback: true }
  > {
    const mediaBytes = params.buffer.length;
    const model = transcribeModelFromEnv();
    const src = params.sourceLabel ?? 'buffer';

    this.logger.log(
      `audioTranscriptionStarted ${JSON.stringify({
        tenantId: params.tenantId,
        conversationId: params.conversationId ?? null,
        webhookEventId: params.webhookEventId ?? null,
        mediaHost: src,
        mediaPathLen: mediaBytes,
        model,
      })}`,
    );

    try {
      const agencyId = await this.getAgencyId(params.tenantId);
      if (!agencyId) throw new Error('no_agency');
      const { data: row, error: rowErr } = await this.supabase
        .from('agency_model_providers')
        .select('provider, api_key, endpoint, settings')
        .eq('agency_id', agencyId)
        .eq('provider', 'OPENAI')
        .maybeSingle();
      if (rowErr || !row) throw new Error('no_openai_row');
      const pr = row as ProviderRow;
      const apiKey = pr.api_key?.trim() ?? '';
      if (!isUsableOpenAiFallbackKey(apiKey)) throw new Error('no_api_key');

      const filename = inferAudioFilenameFromMime(params.contentType);
      const transcript = await this.callOpenAiTranscription({
        apiKey,
        endpoint: pr.endpoint,
        buffer: params.buffer,
        filename,
        mimeHint: params.contentType,
      });

      this.logger.log(
        `audioTranscriptionSucceeded ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId ?? null,
          webhookEventId: params.webhookEventId ?? null,
          transcriptCharCount: transcript.length,
          mediaBytes,
        })}`,
      );

      return { ok: true, transcript, mediaBytes, contentType: params.contentType };
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown';
      this.logger.warn(
        `audioTranscriptionFailed ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId ?? null,
          webhookEventId: params.webhookEventId ?? null,
          errorCode: code,
          mediaBytes,
        })}`,
      );
      return { ok: false, errorCode: code, userFacingFallback: true };
    }
  }
}
