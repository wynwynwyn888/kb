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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asRecordArray(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => Boolean(asRecord(x)));
}

function extractMessagesArray(payload: unknown): {
  rows: Record<string, unknown>[];
  detectedCollectionPath: string;
} {
  const root = asRecord(payload);
  if (!root) return { rows: [], detectedCollectionPath: 'none' };

  const pathCandidates: Array<{ path: string; value: unknown }> = [
    { path: 'messages', value: root['messages'] },
    { path: 'data.messages', value: asRecord(root['data'])?.['messages'] },
    {
      path: 'data.conversation.messages',
      value: asRecord(asRecord(root['data'])?.['conversation'])?.['messages'],
    },
    { path: 'conversation.messages', value: asRecord(root['conversation'])?.['messages'] },
    { path: 'data.items', value: asRecord(root['data'])?.['items'] },
    { path: 'items', value: root['items'] },
    { path: 'data.results', value: asRecord(root['data'])?.['results'] },
    { path: 'results', value: root['results'] },
  ];

  for (const p of pathCandidates) {
    const rows = asRecordArray(p.value);
    if (rows.length > 0) return { rows, detectedCollectionPath: p.path };
  }
  return { rows: [], detectedCollectionPath: 'none' };
}

function firstNonEmptyString(values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function extractBody(row: Record<string, unknown>): string {
  const messageObj = asRecord(row['message']);
  const payloadObj = asRecord(row['payload']);
  return firstNonEmptyString([
    row['body'],
    row['message'],
    row['text'],
    row['content'],
    messageObj?.['body'],
    messageObj?.['text'],
    messageObj?.['content'],
    payloadObj?.['body'],
    payloadObj?.['message'],
  ]);
}

function hasAudioHintInString(v: string): boolean {
  const s = v.toLowerCase();
  return (
    s.includes('audio') ||
    s.includes('voice') ||
    /\.(m4a|mp3|wav|ogg|oga|aac|amr|webm|opus|aiff?)(\?|#|$)/i.test(s)
  );
}

function attachmentMediaAudioHint(row: Record<string, unknown>): {
  isCandidate: boolean;
  hasAttachments: boolean;
  attachmentCount: number;
  hasMedia: boolean;
  mediaKeyNodeCount: number;
} {
  const attachments = row['attachments'];
  const media = row['media'];
  let attachmentCount = 0;
  let hasAttachments = false;
  let hasMedia = false;
  let mediaKeyNodeCount = 0;
  let audioHint = false;

  if (Array.isArray(attachments)) {
    hasAttachments = true;
    attachmentCount = attachments.length;
    for (const item of attachments) {
      const r = asRecord(item);
      if (!r) continue;
      const mime = String(r['contentType'] ?? r['mimeType'] ?? '').toLowerCase();
      const name = String(r['name'] ?? r['filename'] ?? r['fileName'] ?? '');
      const url = String(r['url'] ?? r['mediaUrl'] ?? r['fileUrl'] ?? '');
      if (mime.startsWith('audio/') || hasAudioHintInString(name) || hasAudioHintInString(url)) {
        audioHint = true;
      }
    }
  }

  if (media !== undefined && media !== null) {
    hasMedia = true;
    if (Array.isArray(media)) {
      mediaKeyNodeCount = media.length;
      for (const item of media) {
        const r = asRecord(item);
        if (!r) continue;
        const mime = String(r['contentType'] ?? r['mimeType'] ?? '').toLowerCase();
        const name = String(r['name'] ?? r['filename'] ?? r['fileName'] ?? '');
        const url = String(r['url'] ?? r['mediaUrl'] ?? r['fileUrl'] ?? '');
        if (mime.startsWith('audio/') || hasAudioHintInString(name) || hasAudioHintInString(url)) {
          audioHint = true;
        }
      }
    } else {
      const r = asRecord(media);
      if (r) {
        mediaKeyNodeCount = Object.keys(r).length > 0 ? 1 : 0;
        const mime = String(r['contentType'] ?? r['mimeType'] ?? '').toLowerCase();
        const name = String(r['name'] ?? r['filename'] ?? r['fileName'] ?? '');
        const url = String(r['url'] ?? r['mediaUrl'] ?? r['fileUrl'] ?? '');
        if (mime.startsWith('audio/') || hasAudioHintInString(name) || hasAudioHintInString(url)) {
          audioHint = true;
        }
      }
    }
  }

  return { isCandidate: audioHint, hasAttachments, attachmentCount, hasMedia, mediaKeyNodeCount };
}

function extractDirectionSource(row: Record<string, unknown>): string {
  return firstNonEmptyString([row['direction'], row['source'], row['from']]).toLowerCase();
}

function isInboundFromDirectionSource(directionSourceLower: string): boolean {
  return /(inbound|customer|contact|user|client)/i.test(directionSourceLower);
}

function redactedBodyPreview(v: string): string {
  return v
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\bsk-[a-zA-Z0-9_-]{10,}\b/gi, '[token]')
    .slice(0, 120);
}

/** Inbound-only: placeholder body classification or obvious audio-ish GHL rows. */
function isInboundVoicePlaceholderCandidate(row: Record<string, unknown>): boolean {
  const directionSource = extractDirectionSource(row);
  if (!isInboundFromDirectionSource(directionSource)) return false;

  const body = extractBody(row);
  const cls = classifyGhlAudioPlaceholderBody(body);
  if (cls === 'AUDIO' || cls === 'VOICE') {
    return true;
  }

  const typeBundle = [
    String(row['type'] ?? ''),
    String(row['messageType'] ?? ''),
    String(row['contentType'] ?? ''),
    String(row['source'] ?? ''),
  ].join(' ');
  if (/voice|audio|VoiceMessage|AudioMessage/i.test(typeBundle)) return true;

  const hints = attachmentMediaAudioHint(row);
  if (hints.isCandidate) return true;

  return false;
}

function resolveMessageRowId(row: Record<string, unknown>): string | null {
  const id =
    row['id'] ??
    row['messageId'] ??
    row['message_id'] ??
    row['conversationMessageId'] ??
    row['_id'];
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

function safeMessageSample(row: Record<string, unknown>, index: number): Record<string, unknown> {
  const id = resolveMessageRowId(row);
  const body = extractBody(row);
  const bodyKind = classifyGhlAudioPlaceholderBody(body);
  const hints = attachmentMediaAudioHint(row);
  const dateAdded = firstNonEmptyString([row['dateAdded'], row['createdAt'], row['timestamp']]);
  return {
    index,
    idPresent: Boolean(id),
    idLen: id ? id.length : undefined,
    direction: firstNonEmptyString([row['direction']]),
    type: firstNonEmptyString([row['type']]),
    messageType: firstNonEmptyString([row['messageType']]),
    contentType: firstNonEmptyString([row['contentType']]),
    source: firstNonEmptyString([row['source']]),
    bodyShape: {
      length: body.length,
      startsWithCharCode: body.length ? body.charCodeAt(0) : 0,
      endsWithCharCode: body.length ? body.charCodeAt(body.length - 1) : 0,
      normalizedPreview: redactedBodyPreview(body),
      bodyPlaceholderKind: bodyKind,
    },
    keySample: Object.keys(row).slice(0, 20),
    hasAttachments: hints.hasAttachments,
    attachmentCount: hints.attachmentCount,
    hasMedia: hints.hasMedia,
    mediaKeyNodeCount: hints.mediaKeyNodeCount,
    dateAdded: dateAdded ? dateAdded.slice(0, 25) : undefined,
  };
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

      const top = asRecord(listResult.json) ?? {};
      const extracted = extractMessagesArray(listResult.json);
      const rows = extracted.rows;
      const candidates = rows.filter((r) => isInboundVoicePlaceholderCandidate(r));
      lastCandidateCount = candidates.length;
      const inboundCount = rows.filter((r) =>
        isInboundFromDirectionSource(extractDirectionSource(r)),
      ).length;

      this.logger.log(
        JSON.stringify({
          voiceMessageDiscoveryAttempt: true,
          attempt,
          responseTopLevelKeys: Object.keys(top).slice(0, 30),
          detectedCollectionPath: extracted.detectedCollectionPath,
          rawItemCount: rows.length,
          candidateCount: lastCandidateCount,
          latestMessageSamples: rows.slice(0, 5).map((r, i) => safeMessageSample(r, i)),
        }),
      );

      if (lastCandidateCount === 0 && inboundCount > 0) {
        this.logger.warn(
          JSON.stringify({
            voiceMessageDiscoveryNoAudioCandidateButRecentInbound: true,
            recentInboundCount: inboundCount,
          }),
        );
      }

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
