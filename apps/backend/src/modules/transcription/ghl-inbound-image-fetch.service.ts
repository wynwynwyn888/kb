/**
 * Resolve GHL-hosted inbound image URLs for vision models.
 * Many attachment URLs require the location OAuth token; public fetch often fails.
 */

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt } from '../../lib/encryption';

const FETCH_TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function isImageContentType(ct: string | null): boolean {
  const v = (ct ?? '').toLowerCase();
  return v.startsWith('image/') || v.includes('image');
}

@Injectable()
export class GhlInboundImageFetchService {
  private readonly logger = new Logger(GhlInboundImageFetchService.name);
  private readonly supabase = getSupabaseService();

  /**
   * Returns a URL suitable for vision APIs: original URL when publicly readable,
   * otherwise a base64 data URL after authenticated GHL fetch.
   */
  async resolveForVision(params: { tenantId: string; mediaUrl: string }): Promise<string | null> {
    const mediaUrl = params.mediaUrl.trim();
    if (!/^https?:\/\//i.test(mediaUrl)) return null;

    const publicOk = await this.tryFetch(mediaUrl, null);
    if (publicOk.ok && isImageContentType(publicOk.contentType)) {
      return mediaUrl;
    }
    const publicFailReason = publicOk.ok ? 'not_image' : publicOk.reason;

    const token = await this.resolveAccessToken(params.tenantId);
    if (!token) {
      this.logger.warn(
        `inboundImageFetchNoToken tenantId=${params.tenantId} publicFetch=${publicFailReason}`,
      );
      return publicOk.ok ? mediaUrl : null;
    }

    const authed = await this.tryFetch(mediaUrl, token);
    if (!authed.ok) {
      this.logger.warn(
        `inboundImageFetchFailed tenantId=${params.tenantId} reason=${authed.reason} publicReason=${publicFailReason}`,
      );
      return null;
    }

    const ct = authed.contentType && isImageContentType(authed.contentType)
      ? authed.contentType
      : 'image/jpeg';
    return `data:${ct};base64,${authed.buffer.toString('base64')}`;
  }

  private async resolveAccessToken(tenantId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('tenant_ghl_connections')
      .select('private_token_encrypted')
      .eq('tenant_id', tenantId)
      .eq('status', 'CONNECTED')
      .maybeSingle();
    if (!data) return null;
    try {
      return decrypt(String(data['private_token_encrypted']));
    } catch {
      return null;
    }
  }

  private async tryFetch(
    url: string,
    token: string | null,
  ): Promise<
    | { ok: true; buffer: Buffer; contentType: string | null }
    | { ok: false; reason: string }
  > {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { Accept: 'image/*,*/*' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Version'] = '2021-07-28';
      }
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ac.signal, headers });
      if (!res.ok) return { ok: false, reason: `http_${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };
      if (buf.length === 0) return { ok: false, reason: 'empty' };
      return { ok: true, buffer: buf, contentType: res.headers.get('content-type') };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch_error';
      return { ok: false, reason: msg.includes('abort') ? 'timeout' : 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}
