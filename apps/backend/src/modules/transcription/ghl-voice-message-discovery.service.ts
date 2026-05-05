/**
 * Phase 1C: when workflow-flat webhooks omit messageId but include an AUDIO/VOICE placeholder body,
 * list conversation messages via GHL and pick the best matching inbound placeholder to obtain a message id
 * for the recording endpoint.
 */

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt } from '../../lib/encryption';
import { classifyGhlAudioPlaceholderBody } from '../webhooks/ghl-inbound-audio-media';

const LIST_TIMEOUT_MS = 35_000;
const MESSAGE_LIMIT = 40;

function ghlApiBase(): string {
  return (
    process.env['GHL_API_BASE_URL']?.trim().replace(/\/$/, '') ||
    'https://services.leadconnectorhq.com'
  );
}

function readBoundedInt(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractMessagesArray(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const m = root['messages'];
  if (!Array.isArray(m)) return [];
  return m.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object');
}

/** Inbound-only: placeholder body classification or obvious audio-ish GHL rows. */
function isInboundVoicePlaceholderCandidate(row: Record<string, unknown>): boolean {
  const dir = String(row['direction'] ?? '').trim().toLowerCase();
  if (dir !== 'inbound') return false;

  const body = String(row['body'] ?? row['text'] ?? row['message'] ?? '');
  const cls = classifyGhlAudioPlaceholderBody(body);
  if (cls === 'AUDIO' || cls === 'VOICE') {
    return true;
  }

  /** Native voice/audio rows while body is empty or non-text */
  const mtRaw = row['messageType'] ?? row['type'];
  const mt = typeof mtRaw === 'string' ? mtRaw : typeof mtRaw === 'number' ? String(mtRaw) : '';
  if (/voice|audio|VOICE|AUDIO|VoiceMessage|AudioMessage/i.test(mt)) return true;

  const ct = String(row['contentType'] ?? '').toLowerCase();
  if (ct.startsWith('audio/')) return true;

  return false;
}

function resolveMessageRowId(row: Record<string, unknown>): string | null {
  const id = row['id'] ?? row['messageId'];
  if (typeof id === 'string' && id.trim()) return id.trim();
  return null;
}

function compareByRecencyNearWebhook(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  webhookMs: number,
): number {
  const ta = Date.parse(String(a['dateAdded'] ?? '')) || 0;
  const tb = Date.parse(String(b['dateAdded'] ?? '')) || 0;
  /** Prefer newer; tie-break by absolute distance to webhook receipt time */
  const byTime = tb - ta;
  if (byTime !== 0) return byTime;
  const da = Math.abs(ta - webhookMs);
  const db = Math.abs(tb - webhookMs);
  return da - db;
}

@Injectable()
export class GhlVoiceMessageDiscoveryService {
  private readonly logger = new Logger(GhlVoiceMessageDiscoveryService.name);
  private readonly supabase = getSupabaseService();

  /**
   * List GET /conversations/:conversationId/messages and pick newest qualifying inbound placeholder.
   */
  async discoverVoicePlaceholderMessageId(params: {
    tenantId: string;
    locationId: string;
    conversationId: string;
    webhookTimestampIso: string;
    placeholderKind: 'AUDIO' | 'VOICE';
  }): Promise<
    | { ok: true; messageId: string; candidateCount: number }
    | { ok: false; reason: string; candidateCount?: number }
  > {
    const delayMs = readBoundedInt('GHL_VOICE_DISCOVER_DELAY_MS', 3000, 0, 120_000);
    const maxAttempts = readBoundedInt('GHL_VOICE_DISCOVER_MAX_ATTEMPTS', 2, 1, 6);
    const convLen = params.conversationId.trim().length;
    const webhookMs = Date.parse(params.webhookTimestampIso) || Date.now();

    this.logger.log(
      JSON.stringify({
        voiceMessageDiscoveryStarted: true,
        tenantId: params.tenantId,
        conversationIdLen: convLen,
        placeholderKind: params.placeholderKind,
        delayMs,
        maxAttempts,
      }),
    );

    await sleep(delayMs);

    const tokenResult = await this.resolveAccessToken(params.tenantId, params.locationId);
    if (!tokenResult.ok) {
      const candidateCount = 0;
      this.logger.warn(
        JSON.stringify({
          voiceMessageDiscoveryFailed: true,
          reason: tokenResult.reason,
          discoveredMessageIdPresent: false,
          candidateCount,
        }),
      );
      return { ok: false, reason: tokenResult.reason, candidateCount };
    }

    const base = ghlApiBase();
    let lastCandidateCount = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await sleep(delayMs);
      }

      const listResult = await this.tryListMessages({
        baseUrl: base,
        token: tokenResult.token,
        conversationId: params.conversationId,
      });

      if (!listResult.ok) {
        this.logger.warn(
          JSON.stringify({
            voiceMessageDiscoveryAttempt: true,
            attempt,
            httpStatus: listResult.httpStatus,
            candidateCount: 0,
          }),
        );
        if (attempt === maxAttempts) {
          this.logger.warn(
            JSON.stringify({
              voiceMessageDiscoveryFailed: true,
              reason: listResult.reason,
              discoveredMessageIdPresent: false,
              candidateCount: 0,
            }),
          );
          return { ok: false, reason: listResult.reason, candidateCount: 0 };
        }
        continue;
      }

      const rows = extractMessagesArray(listResult.json);
      const candidates = rows.filter((r) => isInboundVoicePlaceholderCandidate(r));
      lastCandidateCount = candidates.length;

      this.logger.log(
        JSON.stringify({
          voiceMessageDiscoveryAttempt: true,
          attempt,
          candidateCount: lastCandidateCount,
        }),
      );

      candidates.sort((a, b) => compareByRecencyNearWebhook(a, b, webhookMs));

      const bestId = candidates.length ? resolveMessageRowId(candidates[0]!) : null;

      if (bestId) {
        this.logger.log(
          JSON.stringify({
            voiceMessageDiscoverySucceeded: true,
            discoveredMessageIdPresent: true,
            candidateCount: lastCandidateCount,
          }),
        );
        return { ok: true, messageId: bestId, candidateCount: lastCandidateCount };
      }

      if (attempt === maxAttempts) {
        const reason = 'message_id_not_found';
        this.logger.warn(
          JSON.stringify({
            voiceMessageDiscoveryFailed: true,
            reason,
            discoveredMessageIdPresent: false,
            candidateCount: lastCandidateCount,
          }),
        );
        return { ok: false, reason, candidateCount: lastCandidateCount };
      }
    }

    const reason = 'message_id_not_found';
    this.logger.warn(
      JSON.stringify({
        voiceMessageDiscoveryFailed: true,
        reason,
        discoveredMessageIdPresent: false,
        candidateCount: lastCandidateCount,
      }),
    );
    return { ok: false, reason, candidateCount: lastCandidateCount };
  }

  private async resolveAccessToken(
    tenantId: string,
    locationId: string,
  ): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
    const { data } = await this.supabase
      .from('tenant_ghl_connections')
      .select('private_token_encrypted')
      .eq('tenant_id', tenantId)
      .eq('ghl_location_id', locationId)
      .eq('status', 'CONNECTED')
      .single();

    if (!data) {
      return { ok: false, reason: 'no_ghl_credentials' };
    }
    try {
      const token = decrypt(String(data['private_token_encrypted']));
      return { ok: true, token };
    } catch {
      return { ok: false, reason: 'token_decrypt_failed' };
    }
  }

  private async tryListMessages(params: {
    baseUrl: string;
    token: string;
    conversationId: string;
  }): Promise<
    | { ok: true; json: unknown }
    | { ok: false; reason: string; httpStatus?: number }
  > {
    const url = `${params.baseUrl}/conversations/${encodeURIComponent(params.conversationId.trim())}/messages?limit=${MESSAGE_LIMIT}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LIST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.token}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
        signal: ac.signal,
      });

      if (!res.ok) {
        if ([400, 401, 404].includes(res.status)) {
          return { ok: false, reason: `http_${res.status}`, httpStatus: res.status };
        }
        return { ok: false, reason: `http_${res.status}`, httpStatus: res.status };
      }

      let json: unknown;
      try {
        json = (await res.json()) as unknown;
      } catch {
        return { ok: false, reason: 'invalid_json' };
      }
      return { ok: true, json };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch_error';
      return { ok: false, reason: msg === 'The operation was aborted' ? 'timeout' : 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}
