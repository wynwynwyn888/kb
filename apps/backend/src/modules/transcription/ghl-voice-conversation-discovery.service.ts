/**
 * Phase 1D: when workflow-flat webhooks omit externalConversationId, discover a likely
 * conversation id by contact + location so Phase 1C message-id discovery can run.
 */

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { decrypt } from '../../lib/encryption';

const SEARCH_TIMEOUT_MS = 35_000;

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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function extractConversationRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) return [];
  const fromConversations = root['conversations'];
  if (Array.isArray(fromConversations)) {
    return fromConversations.filter((x): x is Record<string, unknown> => Boolean(asRecord(x)));
  }
  const fromData = root['data'];
  if (Array.isArray(fromData)) {
    return fromData.filter((x): x is Record<string, unknown> => Boolean(asRecord(x)));
  }
  const dataObj = asRecord(fromData);
  const items = dataObj?.['items'];
  if (Array.isArray(items)) {
    return items.filter((x): x is Record<string, unknown> => Boolean(asRecord(x)));
  }
  const fromItems = root['items'];
  if (Array.isArray(fromItems)) {
    return fromItems.filter((x): x is Record<string, unknown> => Boolean(asRecord(x)));
  }
  return [];
}

function rowConversationId(row: Record<string, unknown>): string | null {
  const id = row['id'] ?? row['conversationId'];
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function rowContactId(row: Record<string, unknown>): string | null {
  const id = row['contactId'] ?? row['contact_id'];
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function rowLocationId(row: Record<string, unknown>): string | null {
  const id = row['locationId'] ?? row['location_id'];
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function rowSortTimeMs(row: Record<string, unknown>): number {
  const v =
    row['last_message_date'] ??
    row['lastMessageDate'] ??
    row['last_message_at'] ??
    row['lastMessageAt'] ??
    row['updatedAt'] ??
    row['dateUpdated'] ??
    row['createdAt'];
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v > 1_000_000_000_000 ? v : v * 1000;
  }
  const parsed = Date.parse(String(v ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

@Injectable()
export class GhlVoiceConversationDiscoveryService {
  private readonly logger = new Logger(GhlVoiceConversationDiscoveryService.name);
  private readonly supabase = getSupabaseService();

  async discoverConversationIdByContact(params: {
    tenantId: string;
    locationId: string;
    contactId: string;
  }): Promise<
    | { ok: true; conversationId: string; candidateCount: number }
    | { ok: false; reason: string; candidateCount?: number }
  > {
    const limit = readBoundedInt('GHL_VOICE_DISCOVER_CONVERSATION_LIMIT', 10, 1, 50);
    this.logger.log(
      JSON.stringify({
        voiceConversationDiscoveryStarted: true,
        tenantId: params.tenantId,
        limit,
      }),
    );

    const tokenResult = await this.resolveAccessToken(params.tenantId, params.locationId);
    if (!tokenResult.ok) {
      this.logger.warn(
        JSON.stringify({
          voiceConversationDiscoveryFailed: true,
          reason: tokenResult.reason,
          candidateCount: 0,
          discoveredConversationIdPresent: false,
        }),
      );
      return { ok: false, reason: tokenResult.reason, candidateCount: 0 };
    }

    const search = await this.trySearchConversations({
      token: tokenResult.token,
      locationId: params.locationId,
      contactId: params.contactId,
      limit,
    });
    if (!search.ok) {
      this.logger.warn(
        JSON.stringify({
          voiceConversationDiscoveryAttempt: true,
          candidateCount: 0,
          httpStatus: search.httpStatus ?? null,
        }),
      );
      this.logger.warn(
        JSON.stringify({
          voiceConversationDiscoveryFailed: true,
          reason: search.reason,
          candidateCount: 0,
          discoveredConversationIdPresent: false,
        }),
      );
      return { ok: false, reason: search.reason, candidateCount: 0 };
    }

    const rows = extractConversationRows(search.json);
    const candidates = rows.filter((row) => {
      const cid = rowContactId(row);
      const lid = rowLocationId(row);
      const id = rowConversationId(row);
      if (!id) return false;
      if (cid && cid !== params.contactId) return false;
      if (lid && lid !== params.locationId) return false;
      return true;
    });
    candidates.sort((a, b) => rowSortTimeMs(b) - rowSortTimeMs(a));
    const discoveredId = candidates.length ? rowConversationId(candidates[0]!) : null;

    this.logger.log(
      JSON.stringify({
        voiceConversationDiscoveryAttempt: true,
        candidateCount: candidates.length,
      }),
    );

    if (!discoveredId) {
      const reason = 'conversation_id_not_found';
      this.logger.warn(
        JSON.stringify({
          voiceConversationDiscoveryFailed: true,
          reason,
          candidateCount: candidates.length,
          discoveredConversationIdPresent: false,
        }),
      );
      return { ok: false, reason, candidateCount: candidates.length };
    }

    this.logger.log(
      JSON.stringify({
        voiceConversationDiscoverySucceeded: true,
        candidateCount: candidates.length,
        discoveredConversationIdPresent: true,
      }),
    );
    return { ok: true, conversationId: discoveredId, candidateCount: candidates.length };
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
    if (!data) return { ok: false, reason: 'no_ghl_credentials' };
    try {
      return { ok: true, token: decrypt(String(data['private_token_encrypted'])) };
    } catch {
      return { ok: false, reason: 'token_decrypt_failed' };
    }
  }

  private async trySearchConversations(params: {
    token: string;
    locationId: string;
    contactId: string;
    limit: number;
  }): Promise<
    | { ok: true; json: unknown }
    | { ok: false; reason: string; httpStatus?: number }
  > {
    const base = ghlApiBase();
    const q = new URLSearchParams({
      locationId: params.locationId,
      contactId: params.contactId,
      sort: 'desc',
      sortBy: 'last_message_date',
      limit: String(params.limit),
    });
    const url = `${base}/conversations/search?${q.toString()}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SEARCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.token}`,
          Version: '2021-04-15',
          Accept: 'application/json',
        },
        signal: ac.signal,
      });
      if (!res.ok) {
        return { ok: false, reason: `http_${res.status}`, httpStatus: res.status };
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return { ok: false, reason: 'invalid_json' };
      }
      return { ok: true, json };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch_error';
      return { ok: false, reason: msg.includes('aborted') ? 'timeout' : 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}
