/**
 * Optional Phase 1B: fetch conversation message recording bytes from GHL when webhooks only
 * ship text placeholders. Disabled unless GHL_VOICE_FETCH_RECORDING_BY_MESSAGE_ID=true.
 */

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt } from '../../lib/encryption';

const FETCH_TIMEOUT_MS = 45_000;
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;

function ghlApiBase(): string {
  return (
    process.env['GHL_API_BASE_URL']?.trim().replace(/\/$/, '') ||
    'https://services.leadconnectorhq.com'
  );
}

@Injectable()
export class GhlVoiceRecordingFetchService {
  private readonly logger = new Logger(GhlVoiceRecordingFetchService.name);
  private readonly supabase = getSupabaseService();

  /**
   * GET /conversations/messages/:messageId/locations/:locationId/recording
   * Returns binary on 200; safe failure codes only in logs (no tokens / payload bodies).
   */
  async tryFetchRecording(params: {
    tenantId: string;
    locationId: string;
    messageId: string;
  }): Promise<
    | { ok: true; buffer: Buffer; contentType: string | null }
    | { ok: false; reason: string }
  > {
    const { data } = await this.supabase
      .from('tenant_ghl_connections')
      .select('private_token_encrypted')
      .eq('tenant_id', params.tenantId)
      .eq('ghl_location_id', params.locationId)
      .eq('status', 'CONNECTED')
      .single();

    if (!data) {
      return { ok: false, reason: 'no_ghl_credentials' };
    }

    let token: string;
    try {
      token = decrypt(String(data['private_token_encrypted']));
    } catch {
      return { ok: false, reason: 'token_decrypt_failed' };
    }

    const base = ghlApiBase();
    const path = `/conversations/messages/${encodeURIComponent(params.messageId)}/locations/${encodeURIComponent(params.locationId)}/recording`;
    const url = `${base}${path}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Version: '2021-07-28',
          Accept: 'audio/*,*/*',
        },
        signal: ac.signal,
      });

      if (res.status === 200) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_RECORDING_BYTES) {
          this.logger.warn(
            `ghlRecordingFetchTooLarge tenantId=${params.tenantId} messageIdLen=${params.messageId.length} bytes=${buf.length}`,
          );
          return { ok: false, reason: 'too_large' };
        }
        const contentType = res.headers.get('content-type');
        return { ok: true, buffer: buf, contentType };
      }

      if ([400, 401, 404].includes(res.status)) {
        this.logger.warn(
          `ghlRecordingFetchHttp tenantId=${params.tenantId} httpStatus=${res.status} messageIdLen=${params.messageId.length}`,
        );
        return { ok: false, reason: `http_${res.status}` };
      }

      this.logger.warn(
        `ghlRecordingFetchHttp tenantId=${params.tenantId} httpStatus=${res.status} messageIdLen=${params.messageId.length}`,
      );
      return { ok: false, reason: `http_${res.status}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch_error';
      this.logger.warn(
        `ghlRecordingFetchFailed tenantId=${params.tenantId} messageIdLen=${params.messageId.length} error=${msg}`,
      );
      return { ok: false, reason: 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}
