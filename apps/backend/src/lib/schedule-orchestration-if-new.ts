/**
 * Shared orchestration provider-level idempotency gate.
 *
 * Must be called by ALL paths (webhook, ghl-sync, post-outbound-sync, watchdog)
 * BEFORE enqueuing an orchestration job for a newly-inserted INBOUND message.
 *
 * Provider identity abstraction:
 *   - When a valid GHL message ID exists: uses real provider identity
 *     lock:orch-provider:{tenantId}:{ghlMessageId}  (120s TTL)
 *     done:orch-provider:{tenantId}:{ghlMessageId}  (24h TTL)
 *
 *   - When GHL webhook omits data.id (missing ghlMessageId):
 *     falls back to a KB-owned identity derived from the persisted KB message ID
 *     lock:orch-provider-fallback:{tenantId}:{kbMessageId}  (120s TTL)
 *     done:orch-provider-fallback:{tenantId}:{kbMessageId}  (24h TTL)
 */

import { randomUUID } from 'crypto';
import type { Logger } from '@nestjs/common';
import type { AppCacheService } from './app-cache.service';

const PROVIDER_LOCK_TTL_SEC = 120;
const PROVIDER_DONE_TTL_SEC = 86_400; // 24 hours

/** Kind discriminator for provider orchestration identity. */
export type ProviderIdentityKind = 'ghl_message_id' | 'kb_fallback';

/** Stable identity used for orchestration lock + done marker. */
export interface ProviderIdentity {
  kind: ProviderIdentityKind;
  value: string;
}

/**
 * Lock / done-marker Redis key prefix per identity kind.
 * Separate prefixes prevent collision between real GHL IDs and KB fallback IDs.
 */
function lockKeyPrefix(kind: ProviderIdentityKind): string {
  return kind === 'ghl_message_id'
    ? 'lock:orch-provider'
    : 'lock:orch-provider-fallback';
}

function doneKeyPrefix(kind: ProviderIdentityKind): string {
  return kind === 'ghl_message_id'
    ? 'done:orch-provider'
    : 'done:orch-provider-fallback';
}

function buildLockKey(tenantId: string, identity: ProviderIdentity): string {
  return `${lockKeyPrefix(identity.kind)}:${tenantId}:${identity.value}`;
}

function buildDoneKey(tenantId: string, identity: ProviderIdentity): string {
  return `${doneKeyPrefix(identity.kind)}:${tenantId}:${identity.value}`;
}

/**
 * Resolve a stable provider identity for orchestration idempotency.
 *
 * When a real GHL message ID is available, it is always preferred — the
 * same identity that pre-dates this change.
 *
 * When GHL omitted ``data.id`` from the webhook, the caller MUST supply a
 * ``kbMessageId`` (the persisted KB ``messages.id``) so a fallback identity
 * can be derived.  Without either identity the gate cannot function.
 */
export function resolveProviderIdentity(params: {
  ghlMessageId?: string | null;
  kbMessageId?: string | null;
}): ProviderIdentity | null {
  const ghlId = params.ghlMessageId?.trim() || null;
  if (ghlId) {
    return { kind: 'ghl_message_id', value: ghlId };
  }
  const kbId = params.kbMessageId?.trim() || null;
  if (kbId) {
    return { kind: 'kb_fallback', value: kbId };
  }
  return null;
}

export type ProviderGateSource = 'webhook' | 'fallback';

export interface ProviderGateParams {
  appCache: AppCacheService | undefined;
  logger: Logger;
  tenantId: string;
  conversationId: string;
  ghlMessageId: string | null | undefined;
  /** KB message ID — used as fallback identity when ghlMessageId is missing. */
  kbMessageId?: string | null;
  ghlTimestamp: string | null | undefined;
  /** 'webhook' = primary trigger (permissive). 'fallback' = sync/watchdog (strict). */
  source: ProviderGateSource;
}

export interface ProviderGateResult {
  /** True if orchestration should proceed. False if blocked/skipped. */
  allowed: boolean;
  /** Reason for blocking (for logging by caller). */
  reason?: string;
  /** Lock owner token — release if orchestration fails before outbound. */
  lockToken?: string;
  /** Resolved identity — caller must store this for done-marker placement. */
  identity?: ProviderIdentity;
}

/**
 * Check whether orchestration should proceed for a provider message.
 *
 * Fallback sources (sync/watchdog): fail closed — require ghlMessageId + Redis.
 * Webhook source: ghlMessageId is preferred, but KB fallback is used when
 *   ghlMessageId is missing AND kbMessageId is available.
 */
export async function checkProviderOrchestrationGate(
  params: ProviderGateParams,
): Promise<ProviderGateResult> {
  const { appCache, logger, tenantId, conversationId, ghlMessageId, ghlTimestamp, source, kbMessageId } = params;
  const isFallback = source === 'fallback';

  // Gate 1a: resolve provider identity
  const identity = resolveProviderIdentity({ ghlMessageId, kbMessageId });
  if (!identity) {
    // Neither GHL ID nor KB fallback ID available — cannot proceed
    return { allowed: false, reason: 'no_provider_identity' };
  }

  const usingFallback = identity.kind === 'kb_fallback';

  if (usingFallback) {
    logger.log(
      `provider_identity_fallback: conversationId=${conversationId} kbMessageId=${identity.value.slice(0, 8)}`,
    );
  }

  // Gate 1b: require stable GHL message ID (original strict path)
  // When a ghlMessageId IS missing and we have a kbMessageId fallback,
  // we proceed through the fallback identity path.
  const msgId = ghlMessageId?.trim() || null;
  if (!msgId && !usingFallback) {
    return { allowed: false, reason: 'no_ghl_message_id' };
  }

  // Gate 2: require recent message — source-aware max age
  // Webhook (primary trigger): strict 5-minute window
  // Fallback (sync/watchdog): up to 30-minute window
  // When using kb_fallback, still check age if timestamp available
  if (ghlTimestamp) {
    const maxAgeMs = isFallback ? 30 * 60 * 1000 : 5 * 60 * 1000;
    const ageMs = Date.now() - new Date(ghlTimestamp).getTime();
    if (ageMs < 0 || ageMs > maxAgeMs) {
      return { allowed: false, reason: `stale_${ageMs}ms`, identity };
    }
  }
  // When using fallback identity and no timestamp, still allow (best-effort)

  // Gate 3: require Redis for fallback source; webhook proceeds without it
  if (!appCache) {
    if (isFallback) {
      return { allowed: false, reason: 'no_cache', identity };
    }
    // Webhook — allow through on Redis read error
    return { allowed: true, reason: 'no_cache_webhook_allowed', identity };
  }

  const doneKey = buildDoneKey(tenantId, identity);
  const lockKey = buildLockKey(tenantId, identity);

  // Gate 4: check done marker (24h TTL)
  try {
    const doneExists = await (appCache as any)['redis']?.exists(doneKey);
    if (doneExists) {
      return { allowed: false, reason: 'already_done', identity };
    }
  } catch {
    if (isFallback) {
      return { allowed: false, reason: 'done_check_failed', identity };
    }
    // Webhook — allow through on Redis read error
    return { allowed: true, reason: 'done_check_failed_webhook_allowed', identity };
  }

  // Gate 5: acquire provider lock (120s TTL)
  const ownerToken = randomUUID();
  const lockResult = await appCache.acquireLock(lockKey, ownerToken, PROVIDER_LOCK_TTL_SEC);
  if (lockResult !== 'acquired') {
    return { allowed: false, reason: `lock_${lockResult}`, identity };
  }

  return { allowed: true, lockToken: ownerToken, identity };
}

/**
 * Release a provider lock if orchestration fails before outbound send.
 */
export async function releaseProviderLock(
  appCache: AppCacheService | undefined,
  tenantId: string,
  identity?: ProviderIdentity | null,
  lockToken?: string,
): Promise<void> {
  if (!identity || !lockToken || !appCache) return;
  const lockKey = buildLockKey(tenantId, identity);
  await appCache.releaseLock(lockKey, lockToken);
}

/**
 * Mark a provider message as done after successful orchestration + reply.
 * Call after outbound send completes.
 *
 * Accepts a ``ProviderIdentity`` so fallback-orchestrated messages get their
 * own done marker under the ``kb_fallback`` key space.
 */
export async function markProviderOrchestrationDone(
  appCache: AppCacheService | undefined,
  tenantId: string,
  identity?: ProviderIdentity | null,
): Promise<void> {
  if (!identity || !appCache) return;

  const doneKey = buildDoneKey(tenantId, identity);
  try {
    await (appCache as any)['redis']?.set(doneKey, '1', 'EX', PROVIDER_DONE_TTL_SEC);
  } catch {
    // Non-critical — best effort
  }
}
