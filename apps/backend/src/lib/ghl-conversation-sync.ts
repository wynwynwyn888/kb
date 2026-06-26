// GHL Conversation Context Sync — Pre-reply sync of GHL messages into KB
// Feature flag: GHL_PRE_REPLY_CONTEXT_SYNC=true
// Spec: kb-pre-reply-sync-spec.md v3

import { Logger } from '@nestjs/common';
import { type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { decrypt } from './encryption';

const logger = new Logger('GhlConversationSync');

interface SyncResult {
  synced: number;
  deduped: number;
  appSkipped: number;
  latencyMs: number;
}

export async function syncGhlConversationContext(params: {
  supabase: SupabaseClient;
  tenantId: string;
  ghlLocationId: string;
  conversationId: string;
  contactId: string;
}): Promise<SyncResult> {
  const { supabase, tenantId, ghlLocationId, conversationId, contactId } = params;
  const t0 = Date.now();
  const result: SyncResult = { synced: 0, deduped: 0, appSkipped: 0, latencyMs: 0 };

  if (!contactId) {
    logger.log(`context_sync_skipped: no contactId conversationId=${conversationId}`);
    return result;
  }

  // Tenant allowlist check
  if (!isTenantAllowedForSync(tenantId)) {
    return result;
  }

  // 1. Resolve token
  const token = await resolveGhlToken(supabase, tenantId, ghlLocationId);
  if (!token) {
    logger.warn(`context_sync_skipped: no GHL token tenantId=${tenantId}`);
    return result;
  }

  const baseUrl = 'https://services.leadconnectorhq.com';
  const hdrs = { Authorization: `Bearer ${token}`, Version: '2021-07-28' };
  const contactIdEnc = encodeURIComponent(contactId);
  const locationIdEnc = encodeURIComponent(ghlLocationId);

  // 2. Resolve native GHL conversation ID (check cache first, then search)
  let nativeId = await getCachedNativeId(supabase, conversationId);

  if (!nativeId) {
    logger.log(`native_ghl_conversation_id_cache_miss: conversationId=${conversationId}`);
    nativeId = await searchNativeConversationId(baseUrl, hdrs, locationIdEnc, contactIdEnc);
    if (!nativeId) {
      result.latencyMs = Date.now() - t0;
      return result;
    }
    await saveCachedNativeId(supabase, conversationId, nativeId);
    logger.log(`native_ghl_conversation_id_saved: conversationId=${conversationId} nativeId=${nativeId}`);
  } else {
    logger.log(`native_ghl_conversation_id_cache_hit: conversationId=${conversationId}`);
  }

  // 3. Fetch messages — with stale cache recovery
  let messages = await fetchGhlMessages(baseUrl, hdrs, nativeId);
  if (!messages && nativeId) {
    // Stale cache — clear, re-search, retry once
    logger.log(`native_ghl_conversation_id_stale: nativeId=${nativeId}`);
    await clearCachedNativeId(supabase, conversationId);
    nativeId = await searchNativeConversationId(baseUrl, hdrs, locationIdEnc, contactIdEnc);
    if (nativeId) {
      await saveCachedNativeId(supabase, conversationId, nativeId);
      messages = await fetchGhlMessages(baseUrl, hdrs, nativeId);
    }
  }

  if (!messages || messages.length === 0) {
    result.latencyMs = Date.now() - t0;
    return result;
  }

  logger.log(`ghl_messages_fetched: total=${messages.length} conversationId=${conversationId}`);

  // 4. Check short-circuit — last synced message matches newest
  const lastSyncedId = await getLastSyncedId(supabase, conversationId);
  const newestMsg = messages[0];
  if (newestMsg && lastSyncedId === newestMsg.id) {
    logger.log(`context_sync_success: no new messages conversationId=${conversationId}`);
    result.latencyMs = Date.now() - t0;
    return result;
  }

  // 5. Process messages (oldest first — messages come newest-first from API)
  const toProcess = [...messages].reverse();
  for (const msg of toProcess) {
    // Skip app-source messages (opportunity updates, internal GHL actions)
    if (msg.source === 'app') {
      result.appSkipped++;
      continue;
    }

    // Dedupe by ghlMessageId
    const exists = await messageExists(supabase, conversationId, msg.id);
    if (exists) {
      result.deduped++;
      continue;
    }

    // Determine sender based on direction + source + ledger check
    const direction = (msg.direction || '').toLowerCase() === 'inbound' ? 'INBOUND' : 'OUTBOUND';
    let sender: string;
    if (direction === 'INBOUND') {
      sender = 'CONTACT';
    } else if (msg.source === 'workflow') {
      sender = 'SYSTEM';
    } else if (msg.source === 'api') {
      // source=api could be KB's own AI reply OR a manual dashboard send.
      // Check the outbound_sends ledger: if KB recorded this messageId, it's our own reply → skip.
      const isOwnReply = await isKbOwnReply(supabase, msg.id);
      if (isOwnReply) {
        // Already in messages table via persistOutboundMessage — dedupe should have caught this.
        // If we reach here, the message was synced before KB persisted it (race condition).
        // Treat as our own reply, skip reinsertion.
        result.deduped++;
        continue;
      }
      sender = 'SYSTEM'; // Manual dashboard send
    } else {
      sender = 'SYSTEM'; // unknown source, conservative
    }

    const { error: insErr } = await supabase.from('messages').insert({
      id: randomUUID(),
      conversation_id: conversationId,
      direction,
      sender,
      content: msg.body || '',
      contentType: 'TEXT',
      metadata: {
        ghlMessageId: msg.id,
        ghlSource: msg.source,
        ghlStatus: msg.status,
        syncedAt: new Date().toISOString(),
      },
      created_at: msg.dateAdded || new Date().toISOString(),
    });

    if (insErr) {
      logger.warn(`messages_insert_error: ghlMessageId=${msg.id} err=${String(insErr)}`);
    } else {
      result.synced++;
    }
  }

  // 6. Update lastSyncedGhlMessageId
  const newestGhlMsg = messages[0];
  if (newestGhlMsg?.id) {
    await saveLastSyncedId(supabase, conversationId, newestGhlMsg.id);
  }

  result.latencyMs = Date.now() - t0;
  logger.log(
    `context_sync_success: conversationId=${conversationId} fetched=${messages.length} inserted=${result.synced} deduped=${result.deduped} appSkipped=${result.appSkipped} sync_latency_ms=${result.latencyMs}`,
  );

  return result;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveGhlToken(supabase: SupabaseClient, tenantId: string, ghlLocationId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenant_ghl_connections')
    .select('private_token_encrypted')
    .eq('tenant_id', tenantId)
    .eq('ghl_location_id', ghlLocationId)
    .eq('status', 'CONNECTED')
    .maybeSingle();
  if (!data) return null;
  try {
    return decrypt(String(data['private_token_encrypted']));
  } catch {
    return null;
  }
}

async function getCachedNativeId(supabase: SupabaseClient, conversationId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('id', conversationId)
    .maybeSingle();
  const meta = data?.metadata as Record<string, unknown> | null;
  return typeof meta?.['nativeGhlConversationId'] === 'string' ? meta['nativeGhlConversationId'] : null;
}

async function saveCachedNativeId(supabase: SupabaseClient, conversationId: string, nativeId: string): Promise<void> {
  const { data: existing } = await supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
  const meta = (existing?.metadata as Record<string, unknown>) ?? {};
  meta['nativeGhlConversationId'] = nativeId;
  meta['nativeGhlConversationIdSavedAt'] = new Date().toISOString();
  await supabase.from('conversations').update({ metadata: meta, updated_at: new Date().toISOString() }).eq('id', conversationId);
}

async function clearCachedNativeId(supabase: SupabaseClient, conversationId: string): Promise<void> {
  const { data: existing } = await supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
  const meta = (existing?.metadata as Record<string, unknown>) ?? {};
  delete meta['nativeGhlConversationId'];
  delete meta['nativeGhlConversationIdSavedAt'];
  await supabase.from('conversations').update({ metadata: meta, updated_at: new Date().toISOString() }).eq('id', conversationId);
}

async function searchNativeConversationId(
  baseUrl: string, hdrs: Record<string, string>, locationIdEnc: string, contactIdEnc: string,
): Promise<string | null> {
  try {
    const url = `${baseUrl}/conversations/search?locationId=${locationIdEnc}&contactId=${contactIdEnc}&limit=1`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(url, { headers: hdrs, signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text();
      if (body.includes('CONVERSATIONS_CONTACT_NOT_FOUND') || body.includes('CONTACT_NOT_FOUND')) {
        logger.log(`context_sync_skipped_no_ghl_conversation: contactId=${contactIdEnc}`);
      } else {
        logger.warn(`context_sync_failed: search HTTP ${res.status}`);
      }
      return null;
    }
    const json = await res.json() as { conversations?: Array<{ id: string }> };
    return json.conversations?.[0]?.id ?? null;
  } catch (e) {
    logger.warn(`context_sync_failed: search error ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function fetchGhlMessages(
  baseUrl: string, hdrs: Record<string, string>, nativeId: string,
): Promise<Array<{ id: string; body: string; direction: string; source: string; dateAdded: string; status: string }> | null> {
  try {
    const url = `${baseUrl}/conversations/${encodeURIComponent(nativeId)}/messages?limit=20`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(url, { headers: hdrs, signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text();
      if (body.includes('CONVERSATIONS_CONVERSATION_NOT_FOUND')) {
        logger.log(`native_ghl_conversation_id_stale: nativeId=${nativeId}`);
      } else {
        logger.warn(`context_sync_failed: messages HTTP ${res.status}`);
      }
      return null;
    }
    const json = await res.json() as { messages?: { messages?: Array<{ id: string; body: string; direction: string; source: string; dateAdded: string; status: string }> } };
    return json.messages?.messages ?? [];
  } catch (e) {
    logger.warn(`context_sync_failed: messages error ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function messageExists(supabase: SupabaseClient, conversationId: string, ghlMessageId: string): Promise<boolean> {
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('metadata->>ghlMessageId', ghlMessageId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function isKbOwnReply(supabase: SupabaseClient, ghlMessageId: string): Promise<boolean> {
  // Check outbound_sends ledger for KB's own sends
  const { data } = await supabase
    .from('outbound_sends')
    .select('id')
    .eq('provider_message_id', ghlMessageId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

function isTenantAllowedForSync(tenantId: string): boolean {
  const allowlist = (process.env['GHL_PRE_REPLY_CONTEXT_SYNC_TENANTS'] ?? '').trim();
  if (!allowlist) {
    // No allowlist set — require explicit global enable flag for safety
    if (process.env['GHL_PRE_REPLY_CONTEXT_SYNC_ALL'] !== 'true') {
      logger.log(`context_sync_tenant_not_allowed: no allowlist and GHL_PRE_REPLY_CONTEXT_SYNC_ALL not true tenantId=${tenantId}`);
      return false;
    }
    logger.log(`context_sync_global_enabled: all tenants tenantId=${tenantId}`);
    return true;
  }
  const ids = allowlist.split(',').map(s => s.trim()).filter(Boolean);
  const allowed = ids.includes(tenantId);
  if (allowed) {
    logger.log(`context_sync_enabled_for_tenant: tenantId=${tenantId}`);
  } else {
    logger.log(`context_sync_tenant_not_allowed: tenantId=${tenantId}`);
  }
  return allowed;
}

async function getLastSyncedId(supabase: SupabaseClient, conversationId: string): Promise<string | null> {
  const { data } = await supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
  const meta = data?.metadata as Record<string, unknown> | null;
  return typeof meta?.['lastSyncedGhlMessageId'] === 'string' ? meta['lastSyncedGhlMessageId'] : null;
}

async function saveLastSyncedId(supabase: SupabaseClient, conversationId: string, messageId: string): Promise<void> {
  const { data: existing } = await supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
  const meta = (existing?.metadata as Record<string, unknown>) ?? {};
  meta['lastSyncedGhlMessageId'] = messageId;
  await supabase.from('conversations').update({ metadata: meta, updated_at: new Date().toISOString() }).eq('id', conversationId);
}
