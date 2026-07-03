// Inbound decision record — durable per-message decision tracking.
// Stored in messages.metadata.inbound_decision JSON field (no migration needed).
// Every real contact inbound message should eventually have a terminal decision.

import type { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

export type InboundDecisionStatus =
  | 'PENDING'
  | 'PROCEED'
  | 'SKIP_AI_OFF_TAG'
  | 'SKIP_DUPLICATE_PROVIDER_DONE'
  | 'SKIP_STALE_DEBOUNCE'
  | 'SKIP_STALE_SEND'
  | 'SKIP_HUMAN_TAKEOVER'
  | 'FAILED_SEND'
  | 'FAILED_ORCHESTRATION'
  | 'PENDING_RECOVERY'
  | 'RECOVERY_SCHEDULED'
  | 'FAILED_RECOVERY_MISSING_PROVIDER_ID';

export type InboundDecisionTrigger =
  | 'webhook'
  | 'recovery_sync'
  | 'ghl_sync'
  | 'watchdog'
  | 'scanner';

export interface InboundDecisionRecord {
  status: InboundDecisionStatus;
  reason?: string;
  outboundMessageId?: string;
  outboundGhlMessageId?: string;
  triggerSource: InboundDecisionTrigger;
  decidedAt: string; // ISO timestamp
}

const DECISION_KEY = 'inbound_decision';

/**
 * Terminal statuses — once reached, no further processing should occur.
 */
const TERMINAL_STATUSES: ReadonlySet<InboundDecisionStatus> = new Set([
  'PROCEED',
  'SKIP_AI_OFF_TAG',
  'SKIP_DUPLICATE_PROVIDER_DONE',
  'SKIP_HUMAN_TAKEOVER',
]);

export function isTerminalDecision(status: InboundDecisionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Record a terminal decision. MUST be awaited. Logs structured error on failure.
 * Idempotent: if a terminal decision already exists, it is NOT overwritten.
 */
export async function recordTerminalDecision(params: {
  supabase: SupabaseClient;
  logger: Logger;
  messageId: string;
  decision: InboundDecisionRecord;
}): Promise<boolean> {
  const { supabase, logger, messageId, decision } = params;
  if (!isTerminalDecision(decision.status)) {
    logger.warn(
      `recordTerminalDecision_non_terminal: messageId=${messageId} status=${decision.status}`,
    );
    return false;
  }
  try {
    const { data: msg } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .maybeSingle();

    const meta = (msg?.metadata ?? {}) as Record<string, unknown>;
    const existing = meta[DECISION_KEY] as InboundDecisionRecord | undefined;
    if (existing && isTerminalDecision(existing.status)) return true; // already terminal

    meta[DECISION_KEY] = decision;
    const { error } = await supabase
      .from('messages')
      .update({ metadata: meta })
      .eq('id', messageId);

    if (error) {
      logger.error(
        `recordTerminalDecision_write_failed: messageId=${messageId} status=${decision.status} error=${error.message}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error(
      `recordTerminalDecision_exception: messageId=${messageId} status=${decision.status} error=${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Record a non-terminal (interim) decision. Fire-and-forget is acceptable —
 * these are staging states that will be replaced by a terminal decision.
 */
export async function recordInterimDecision(params: {
  supabase: SupabaseClient;
  messageId: string;
  decision: InboundDecisionRecord;
}): Promise<void> {
  const { supabase, messageId, decision } = params;
  try {
    const { data: msg } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .maybeSingle();

    const meta = (msg?.metadata ?? {}) as Record<string, unknown>;
    const existing = meta[DECISION_KEY] as InboundDecisionRecord | undefined;
    if (existing && isTerminalDecision(existing.status)) return;

    meta[DECISION_KEY] = decision;
    await supabase
      .from('messages')
      .update({ metadata: meta })
      .eq('id', messageId);
  } catch {
    // Non-critical — interim
  }
}

/**
 * Record decision that a duplicate provider message was seen.
 * The original message already has (or will have) the terminal decision.
 */
export async function recordDuplicateDecision(params: {
  supabase: SupabaseClient;
  logger: Logger;
  duplicateMessageId: string;
  existingProviderMessageId: string;
}): Promise<void> {
  const { supabase, logger, duplicateMessageId, existingProviderMessageId } = params;
  await recordTerminalDecision({
    supabase,
    logger,
    messageId: duplicateMessageId,
    decision: {
      status: 'SKIP_DUPLICATE_PROVIDER_DONE',
      reason: `duplicate of provider message ${existingProviderMessageId}`,
      triggerSource: 'webhook',
      decidedAt: new Date().toISOString(),
    },
  });
}

/**
 * Find CONTACT/INBOUND messages without a terminal decision and without
 * a later OUTBOUND/AI reply. Used by the scanner.
 */
export async function findUnrepliedInboundMessages(params: {
  supabase: SupabaseClient;
  lookbackMinutes: number;
  limit: number;
}): Promise<Array<{
  id: string;
  conversation_id: string;
  tenant_id: string;
  content?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}>> {
  const { supabase, lookbackMinutes, limit } = params;
  const windowStart = new Date(
    Date.now() - lookbackMinutes * 60 * 1000,
  ).toISOString();

  const { data: candidates } = await supabase
    .from('messages')
    .select('id, conversation_id, tenant_id, content, metadata, created_at')
    .eq('direction', 'INBOUND')
    .eq('sender', 'CONTACT')
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!candidates?.length) return [];

  const unreplied: Array<{
    id: string; conversation_id: string; tenant_id: string;
    content?: string; metadata: Record<string, unknown>; created_at: string;
  }> = [];
  for (const row of candidates) {
    const msg = row as Record<string, unknown>;
    const meta = (msg['metadata'] ?? {}) as Record<string, unknown>;
    const decision = meta[DECISION_KEY] as InboundDecisionRecord | undefined;

    if (decision && isTerminalDecision(decision.status)) continue;

    const { data: laterOb } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', msg['conversation_id'] as string)
      .eq('direction', 'OUTBOUND')
      .eq('sender', 'AI')
      .gte('created_at', msg['created_at'] as string)
      .limit(1)
      .maybeSingle();

    if (laterOb) continue;

    unreplied.push({
      id: msg['id'] as string,
      conversation_id: msg['conversation_id'] as string,
      tenant_id: msg['tenant_id'] as string,
      content: typeof msg['content'] === 'string' ? msg['content'] as string : undefined,
      metadata: meta,
      created_at: msg['created_at'] as string,
    });
  }

  return unreplied;
}
