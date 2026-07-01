// Shared inbound / external message ingest with 3-tier dedupe.
//
// Tier 1: Dedupe by ghlMessageId (GHL's internal message ID from webhook data.id or API).
// Tier 2: If no ghlMessageId, dedupe by contentFingerprint within the same conversation.
// Tier 3: Upgrade: when sync later discovers a real ghlMessageId for a fallback row,
//   update the existing row's metadata rather than inserting a duplicate.
//
// Callers decide whether to schedule orchestration — this function only handles
// storage and dedupe.

import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

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
}

export function computeContentFingerprint(params: IngestInboundParams): string {
  const body = params.content.trim();
  const dateBucket = (params.ghlTimestamp || new Date().toISOString()).slice(0, 16); // minute precision
  const raw = `${params.tenantId}:${params.conversationId}:${body}:${dateBucket}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 40);
}

function buildMessageMetadata(params: IngestInboundParams, fingerprint: string): Record<string, unknown> {
  return {
    ghlMessageId: params.ghlMessageId?.trim() || undefined,
    webhookEventId: params.webhookEventId?.trim() || undefined,
    contentFingerprint: fingerprint,
    ingestSource: params.ingestSource,
    ingestedAt: new Date().toISOString(),
    ghlTimestamp: params.ghlTimestamp?.trim() || undefined,
    ...(params.sourceMetadata ?? {}),
  };
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

  // Insert new message — with DB-level conflict handling
  const newId = randomUUID();
  const metadata = buildMessageMetadata(params, fingerprint);

  const { error: insErr } = await supabase.from('messages').insert({
    id: newId,
    conversation_id: conversationId,
    direction: params.direction,
    sender: params.sender,
    content: params.content,
    contentType: params.contentType,
    metadata,
    created_at: params.ghlTimestamp?.trim() || new Date().toISOString(),
  }).select('id').single();

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
