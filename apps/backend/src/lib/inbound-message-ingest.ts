// Shared inbound / external message ingest with 4-tier dedupe.
//
// Tier 1: Dedupe by ghlMessageId (GHL's internal message ID from webhook data.id or API).
// Tier 2: Dedupe by contentFingerprint within the same conversation.
// Tier 2.5: Cross-path dedupe — if fingerprint missed (different timestamps), check recent
//   same-content messages within CROSS_PATH_DEDUPE_WINDOW_MS (120s). Prevents duplicate
//   inbound when shared ingest and webhook/recovery sync deliver the same message with
//   different timestamps.
// Tier 3: Upgrade: when sync later discovers a real ghlMessageId for a fallback row,
//   update the existing row's metadata rather than inserting a duplicate.
//
// Callers decide whether to schedule orchestration — this function only handles
// storage and dedupe.

import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const CROSS_PATH_DEDUPE_WINDOW_MS = 120_000; // 120 seconds

export interface IngestInboundParams {
  supabase: SupabaseClient;
  conversationId: string;
  tenantId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sender: string;
  content: string;
  contentType: string;
  ghlMessageId?: string | null;        // GHL internal message ID (may be absent)
  webhookEventId?: string | null;      // KB UUID if webhook had no data.id
  ghlTimestamp?: string | null;        // Original GHL message timestamp
  ingestSource: 'webhook' | 'ghl-sync' | 'post-outbound-sync';
  sourceMetadata?: Record<string, unknown>;  // Extra metadata (ghlSource, ghlStatus, etc.)
}

export interface IngestResult {
  inserted: boolean;
  duplicate: boolean;
  upgraded: boolean;            // Fallback row was upgraded with real ghlMessageId
  messageId: string;
  fingerprintConflict?: boolean; // Fingerprint matched but both rows have different real ghlMessageIds
  skippedCrossPathDuplicate?: boolean; // Tier 2.5: same content within 120s window, skipped insertion
}

export function computeContentFingerprint(params: IngestInboundParams): string {
  const body = params.content.trim();
  const dateBucket = (params.ghlTimestamp || new Date().toISOString()).slice(0, 16); // minute precision
  const raw = `${params.tenantId}:${params.conversationId}:${body}:${dateBucket}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 40);
}

function isValidIsoTimestamp(ts: string): boolean {
  try {
    const trimmed = ts.trim();
    // Must contain 'T' (ISO 8601 datetime separator) or be a full RFC 3339 date
    // Reject bare dates like "2026-01-01" and bare times like "11:54"
    if (!trimmed.includes('T') && !trimmed.includes(' ')) return false;
    const d = new Date(trimmed);
    return !isNaN(d.getTime());
  } catch {
    return false;
  }
}

function resolveCreatedAt(ghlTimestamp?: string | null): {
  createdAt: string | undefined;
  ghlTimestampValid: boolean;
} {
  const raw = ghlTimestamp?.trim();
  if (raw && isValidIsoTimestamp(raw)) {
    return { createdAt: raw, ghlTimestampValid: true };
  }
  // Invalid/missing → omit created_at so DB default now() applies
  return { createdAt: undefined, ghlTimestampValid: false };
}

function buildMessageMetadata(params: IngestInboundParams, fingerprint: string): Record<string, unknown> {
  const rawTs = params.ghlTimestamp?.trim();
  const { createdAt, ghlTimestampValid } = resolveCreatedAt(params.ghlTimestamp);
  return {
    ghlMessageId: params.ghlMessageId?.trim() || undefined,
    webhookEventId: params.webhookEventId?.trim() || undefined,
    contentFingerprint: fingerprint,
    ingestSource: params.ingestSource,
    ingestedAt: new Date().toISOString(),
    ghlTimestamp: ghlTimestampValid ? rawTs : undefined,
    ghlTimestampRaw: rawTs || undefined,
    ...(params.sourceMetadata ?? {}),
  };
}

/**
 * Tier 2.5: Cross-path duplicate check.
 *
 * When the fingerprint-based dedupe (Tier 2) misses because timestamps differ
 * between shared ingest and webhook/recovery sync paths, this checks for recent
 * messages with the same content AND same original GHL/provider timestamp.
 * Only skips when timestamps match within 5 seconds — if the text is the same
 * but the GHL timestamp differs, it is a genuinely new user message.
 */
async function checkCrossPathDuplicate(
  supabase: SupabaseClient,
  params: IngestInboundParams,
): Promise<{ id: string } | null> {
  const content = params.content.trim();
  if (!content) return null;

  // Only meaningful for INBOUND messages
  if (params.direction !== 'INBOUND') return null;

  const ghlTs = params.ghlTimestamp?.trim();
  const hasTs = ghlTs && isValidIsoTimestamp(ghlTs);

  const windowStart = new Date(Date.now() - CROSS_PATH_DEDUPE_WINDOW_MS).toISOString();
  const ghlWindowStart = hasTs
    ? new Date(new Date(ghlTs).getTime() - CROSS_PATH_DEDUPE_WINDOW_MS).toISOString()
    : windowStart;

  // Query: find messages in same conversation with matching content created recently
  // Include metadata to compare ghlTimestamp
  const { data: recent } = await supabase
    .from('messages')
    .select('id, metadata')
    .eq('conversation_id', params.conversationId)
    .eq('content', content)
    .gte('created_at', ghlWindowStart)
    .order('created_at', { ascending: true })
    .limit(1);

  const first = recent?.[0];
  if (!first) return null;

  // Compare GHL timestamps: only skip if timestamps match within 5 seconds.
  // This ensures same-text messages at different times are NOT blocked.
  if (hasTs) {
    const existingMeta = (first.metadata ?? {}) as Record<string, unknown>;
    const existingTs = typeof existingMeta['ghlTimestamp'] === 'string'
      ? existingMeta['ghlTimestamp'].trim()
      : null;

    if (existingTs && isValidIsoTimestamp(existingTs)) {
      const diffMs = Math.abs(new Date(ghlTs).getTime() - new Date(existingTs).getTime());
      if (diffMs > 5000) {
        // Different original GHL message (timestamps differ by > 5s) → allow insertion
        return null;
      }
      // Timestamps match within 5s → same original message arriving via two paths → dedupe
      return { id: first.id as string };
    }
    // Existing has no valid ghlTimestamp — can't confirm identity → allow insertion
    return null;
  }

  // Incoming has no ghlTimestamp — can't confirm it's the same message → allow insertion
  return null;
}

export async function ingestInboundMessage(
  params: IngestInboundParams,
): Promise<IngestResult> {
  const { supabase, conversationId, tenantId } = params;
  const fingerprint = computeContentFingerprint(params);
  const ghlMsgId = params.ghlMessageId?.trim() || null;

  // Tier 1: Dedupe by ghlMessageId
  if (ghlMsgId) {
    const { data: existing } = await supabase
      .from('messages')
      .select('id, metadata')
      .eq('conversation_id', conversationId)
      .filter('metadata->>ghlMessageId', 'eq', ghlMsgId)
      .maybeSingle();

    if (existing) {
      return { inserted: false, duplicate: true, upgraded: false, messageId: existing.id as string };
    }
  }

  // Tier 2: Dedupe by contentFingerprint (fallback path)
  const { data: fpMatch } = await supabase
    .from('messages')
    .select('id, metadata')
    .eq('conversation_id', conversationId)
    .filter('metadata->>contentFingerprint', 'eq', fingerprint)
    .maybeSingle();

  if (fpMatch) {
    const meta = (fpMatch.metadata ?? {}) as Record<string, unknown>;
    const existingGhlId = typeof meta['ghlMessageId'] === 'string' ? meta['ghlMessageId'].trim() : null;

    // Tier 3: Upgrade — fallback row has no ghlMessageId; incoming message has one
    if (ghlMsgId && !existingGhlId) {
      await supabase
        .from('messages')
        .update({
          metadata: {
            ...meta,
            ghlMessageId: ghlMsgId,
            upgradedBy: params.ingestSource,
            upgradedAt: new Date().toISOString(),
          },
        })
        .eq('id', fpMatch.id as string);

      return { inserted: false, duplicate: true, upgraded: true, messageId: fpMatch.id as string };
    }

    // Fingerprint conflict: both have different real ghlMessageIds
    if (ghlMsgId && existingGhlId && existingGhlId !== ghlMsgId) {
      return {
        inserted: false, duplicate: false, upgraded: false,
        messageId: fpMatch.id as string, fingerprintConflict: true,
      };
    }

    // Same fingerprint, same or no ghlMessageId → genuine duplicate
    return { inserted: false, duplicate: true, upgraded: false, messageId: fpMatch.id as string };
  }

  // Tier 2.5: Cross-path dedupe — fingerprint missed (different timestamps) but same content
  // may exist from another ingest path (shared ingest vs webhook vs recovery sync)
  const crossPathMatch = await checkCrossPathDuplicate(supabase, params);
  if (crossPathMatch) {
    return {
      inserted: false,
      duplicate: false,
      upgraded: false,
      messageId: crossPathMatch.id,
      skippedCrossPathDuplicate: true,
    };
  }

  // Insert new message — with DB-level conflict handling
  const newId = randomUUID();
  const metadata = buildMessageMetadata(params, fingerprint);
  const { createdAt } = resolveCreatedAt(params.ghlTimestamp);

  const insertRow: Record<string, unknown> = {
    id: newId,
    conversation_id: conversationId,
    direction: params.direction,
    sender: params.sender,
    content: params.content,
    contentType: params.contentType,
    metadata,
  };
  if (createdAt) {
    insertRow['created_at'] = createdAt;
  }

  const { error: insErr } = await supabase.from('messages').insert(insertRow).select('id').single();

  if (insErr) {
    const msg = String(insErr?.message ?? insErr ?? '');
    // Unique constraint conflict — another process inserted the same message first
    if (/23505|duplicate key|unique constraint/i.test(msg)) {
      // Re-query: find the row that was inserted by the other process
      if (ghlMsgId) {
        const { data: existing } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .filter('metadata->>ghlMessageId', 'eq', ghlMsgId)
          .maybeSingle();
        if (existing) {
          return { inserted: false, duplicate: true, upgraded: false, messageId: existing.id as string };
        }
      }
      // Fallback: query by fingerprint
      const { data: fpExisting } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .filter('metadata->>contentFingerprint', 'eq', fingerprint)
        .maybeSingle();
      if (fpExisting) {
        return { inserted: false, duplicate: true, upgraded: false, messageId: fpExisting.id as string };
      }
    }
    throw new Error(`ingestInboundMessage insert failed: ${msg}`);
  }

  return { inserted: true, duplicate: false, upgraded: false, messageId: newId };
}
