/**
 * Shared orchestration provider-level idempotency gate.
 *
 * Must be called by ALL paths (webhook, ghl-sync, post-outbound-sync, watchdog)
 * BEFORE enqueuing an orchestration job for a newly-inserted INBOUND message.
 *
 * Provider lock:   lock:orch-provider:{tenantId}:{ghlMessageId}  (120s TTL)
 * Done marker:     done:orch-provider:{tenantId}:{ghlMessageId}  (24h TTL)
 */

import { randomUUID } from 'crypto';
import type { Logger } from '@nestjs/common';
import type { AppCacheService } from './app-cache.service';

const PROVIDER_LOCK_TTL_SEC = 120;
const PROVIDER_DONE_TTL_SEC = 86_400; // 24 hours

export type ProviderGateSource = 'webhook' | 'fallback';

export interface ProviderGateParams {
  appCache: AppCacheService | undefined;
  logger: Logger;
  tenantId: string;
  conversationId: string;
  ghlMessageId: string | null | undefined;
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
}

/**
 * Check whether orchestration should proceed for a provider message.
 *
 * Fallback sources (sync/watchdog): fail closed — require ghlMessageId + Redis.
 * Webhook source: ghlMessageId is optional (primary trigger), but provider
 *   gate is still checked when ID is available.
 */
export async function checkProviderOrchestrationGate(
  params: ProviderGateParams,
): Promise<ProviderGateResult> {
  const { appCache, logger, tenantId, conversationId, ghlMessageId, ghlTimestamp, source } = params;
  const isFallback = source === 'fallback';

  // Gate 1: require stable GHL message ID
  const msgId = ghlMessageId?.trim() || null;
  if (!msgId) {
    // Both paths require ghlMessageId for provider-level safety.
    // Webhook without it relies on sync fallback to discover the real ID.
    return { allowed: false, reason: 'no_ghl_message_id' };
  }

  // Gate 2: require recent message (≤ 5 min)
  if (!ghlTimestamp) {
    return { allowed: false, reason: 'no_timestamp' };
  }
  const ageMs = Date.now() - new Date(ghlTimestamp).getTime();
  if (ageMs < 0 || ageMs > 5 * 60 * 1000) {
    return { allowed: false, reason: `stale_${ageMs}ms` };
  }

  // Gate 3: require Redis for fallback; webhook proceeds without it
  if (!appCache) {
    if (isFallback) {
      return { allowed: false, reason: 'no_cache' };
    }
    return { allowed: true, reason: 'no_cache_webhook_allowed' };
  }

  const doneKey = `done:orch-provider:${tenantId}:${msgId}`;
  const lockKey = `lock:orch-provider:${tenantId}:${msgId}`;

  // Gate 4: check done marker (24h TTL)
  try {
    const doneExists = await (appCache as any)['redis']?.exists(doneKey);
    if (doneExists) {
      return { allowed: false, reason: 'already_done' };
    }
  } catch {
    if (isFallback) {
      return { allowed: false, reason: 'done_check_failed' };
    }
    // Webhook — allow through on Redis read error
    return { allowed: true, reason: 'done_check_failed_webhook_allowed' };
  }

  // Gate 5: acquire provider lock (120s TTL)
  const ownerToken = randomUUID();
  const lockResult = await appCache.acquireLock(lockKey, ownerToken, PROVIDER_LOCK_TTL_SEC);
  if (lockResult !== 'acquired') {
    return { allowed: false, reason: `lock_${lockResult}` };
  }

  return { allowed: true, lockToken: ownerToken };
}

/**
 * Release a provider lock if orchestration fails before outbound send.
 */
export async function releaseProviderLock(
  appCache: AppCacheService | undefined,
  tenantId: string,
  ghlMessageId: string | null | undefined,
  lockToken?: string,
): Promise<void> {
  const msgId = ghlMessageId?.trim() || null;
  if (!msgId || !lockToken || !appCache) return;
  const lockKey = `lock:orch-provider:${tenantId}:${msgId}`;
  await appCache.releaseLock(lockKey, lockToken);
}

/**
 * Mark a provider message as done after successful orchestration + reply.
 * Call after outbound send completes.
 */
export async function markProviderOrchestrationDone(
  appCache: AppCacheService | undefined,
  tenantId: string,
  ghlMessageId: string | null | undefined,
): Promise<void> {
  const msgId = ghlMessageId?.trim() || null;
  if (!msgId || !appCache) return;

  const doneKey = `done:orch-provider:${tenantId}:${msgId}`;
  try {
    await (appCache as any)['redis']?.set(doneKey, '1', 'EX', PROVIDER_DONE_TTL_SEC);
  } catch {
    // Non-critical — best effort
  }
}
