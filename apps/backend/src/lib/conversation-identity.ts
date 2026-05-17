/**
 * Stable conversation identity for inbound messages.
 *
 * Inputs from a webhook may not include a provider conversation id (e.g. flat GHL Workflow payloads),
 * but **must** include a stable contact identifier per channel. We derive a deterministic key from
 * `tenantId + channel + contactId` so successive messages from the same contact reuse the same
 * internal conversation row instead of creating a fresh one per webhook.
 */

import { createHash } from 'node:crypto';

export type ConversationChannel = string;

export interface ConversationIdentityInput {
  tenantId: string;
  /** Provider channel (whatsapp, sms, instagram, ...). Defaults to WHATSAPP for GHL. */
  channel?: ConversationChannel | null;
  /** Contact id from the provider (always present for delivered customer messages). */
  externalContactId: string;
  /** Provider conversation id when present. Empty/undefined means it must be derived. */
  externalConversationId?: string | null;
}

export interface ConversationIdentityResult {
  /** Stable per (tenant, channel, contact) — always set. */
  derivedConversationKey: string;
  /** External provider conversation id, normalised. `null` when missing. */
  externalConversationId: string | null;
  /** Either the external id or the derived key (used for legacy `ghl_conversation_id` column). */
  preferredExternalId: string;
  /** Short hash for safe logs. */
  derivedKeyHash: string;
  /** True when no external id was supplied (we used a derived id). */
  derivedFromContact: boolean;
  channel: ConversationChannel;
}

const DERIVED_PREFIX = 'aisbp:conv';

function normChannel(channel: string | null | undefined): string {
  const c = (channel ?? '').trim().toLowerCase();
  if (!c) return 'whatsapp';
  return c;
}

/**
 * Compute a deterministic identity for an inbound message. Pure function — no I/O.
 *
 * The derived key is shaped `aisbp:conv:<channel>:<tenantId>:<contactId>` so it is:
 * - human inspectable in logs
 * - unique across tenants
 * - stable across webhooks for the same contact on the same channel
 */
export function deriveConversationIdentity(
  input: ConversationIdentityInput,
): ConversationIdentityResult {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new Error('deriveConversationIdentity: tenantId is required');
  }
  const externalContactId = input.externalContactId.trim();
  if (!externalContactId) {
    throw new Error('deriveConversationIdentity: externalContactId is required');
  }

  const channel = normChannel(input.channel);
  const externalConversationId =
    typeof input.externalConversationId === 'string' && input.externalConversationId.trim() !== ''
      ? input.externalConversationId.trim()
      : null;

  const derivedConversationKey = `${DERIVED_PREFIX}:${channel}:${tenantId}:${externalContactId}`;
  const derivedKeyHash = createHash('sha1').update(derivedConversationKey).digest('hex').slice(0, 12);

  return {
    derivedConversationKey,
    externalConversationId,
    preferredExternalId: externalConversationId ?? derivedConversationKey,
    derivedKeyHash,
    derivedFromContact: externalConversationId === null,
    channel,
  };
}

/** True when a saved `ghl_conversation_id` looks like one of our derived keys. */
export function isDerivedConversationKey(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith(`${DERIVED_PREFIX}:`);
}

/** Channel segment from `aisbp:conv:<channel>:<tenantId>:<contactId>`, when present. */
export function channelFromDerivedConversationKey(value: string | null | undefined): string | null {
  if (!isDerivedConversationKey(value)) return null;
  const parts = value!.split(':');
  if (parts.length < 4 || parts[0] !== 'aisbp' || parts[1] !== 'conv') return null;
  const ch = parts[2]?.trim().toLowerCase();
  return ch || null;
}
