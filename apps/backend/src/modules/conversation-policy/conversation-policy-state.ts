/**
 * Conversation policy state in `conversations.metadata.aisbp_policy`.
 *
 * Generic option memory:
 * - `options` is a label → text map for the most recent assistant choice list (A/B/C/D, 1/2/3, …).
 * - `optionsUpdatedAt` and `optionsSource` track *why* it is there so it can be cleared when the
 *   business prompt updates or the list goes stale (24h TTL).
 *
 * No DB migration — uses the existing JSON `metadata` column.
 */

export const AISBP_POLICY_METADATA_KEY = 'aisbp_policy';

export type PolicyAwaiting = 'menu_category_selection' | 'option_selection' | null;

export interface AisbpPolicyOptionMemoryEntry {
  /** Source of the option list (`assistant_reply` for free-form, `policy_engine` for forced lists). */
  source: 'assistant_reply' | 'policy_engine';
  /** ISO timestamp of when the options were last refreshed. */
  updatedAt: string;
  /** Optional — KB chunk ids the options were derived from (so we can re-link selection→KB). */
  derivedFromChunkIds?: string[];
}

export interface AisbpPolicyStateV1 {
  v: 1;
  activeTopic?: string | null;
  awaiting?: PolicyAwaiting;
  /** Option key → label (e.g. A → Haircut & Styling) */
  options?: Record<string, string>;
  lastAssistantOptions?: Record<string, string>;
  /** When the option list was last (re)written. Used for stale-state clearing. */
  optionsUpdatedAt?: string | null;
  /** Where the option list came from. */
  optionsSource?: AisbpPolicyOptionMemoryEntry['source'] | null;
  /** Optional KB chunk ids backing the options. */
  optionsDerivedFromChunkIds?: string[] | null;
  /** Tenant the option memory was created for. Tenant change → drop options. */
  optionsTenantId?: string | null;
  expiresAt?: string | null;
  updatedAt?: string | null;
  /** ISO time — memory loader only includes messages with created_at strictly after this. */
  memoryResetAt?: string | null;
  /** Incremented on each bot state reset (chat command or dashboard). */
  resetVersion?: number;
}

export function emptyPolicyState(): AisbpPolicyStateV1 {
  return {
    v: 1,
    activeTopic: null,
    awaiting: null,
    options: undefined,
    lastAssistantOptions: undefined,
    optionsUpdatedAt: null,
    optionsSource: null,
    optionsDerivedFromChunkIds: null,
    optionsTenantId: null,
    expiresAt: null,
    updatedAt: null,
    memoryResetAt: null,
    resetVersion: 0,
  };
}

/** Keys cleared from policy JSON on `/new`-style reset (for logs / audits). */
export const BOT_RESET_CLEARED_POLICY_KEYS = [
  'activeTopic',
  'awaiting',
  'options',
  'lastAssistantOptions',
  'optionsUpdatedAt',
  'optionsSource',
  'optionsDerivedFromChunkIds',
  'optionsTenantId',
  'expiresAt',
] as const;

/**
 * Replace flow-bearing policy fields while bumping reset counters.
 * Preserves `v`; sets fresh option/awaiting state and memoryResetAt.
 */
export function policyStateAfterBotReset(prev: AisbpPolicyStateV1, resetAtIso: string): AisbpPolicyStateV1 {
  const nextVersion = (prev.resetVersion ?? 0) + 1;
  return {
    v: 1,
    activeTopic: null,
    awaiting: null,
    options: undefined,
    lastAssistantOptions: undefined,
    optionsUpdatedAt: null,
    optionsSource: null,
    optionsDerivedFromChunkIds: null,
    optionsTenantId: null,
    expiresAt: null,
    updatedAt: resetAtIso,
    memoryResetAt: resetAtIso,
    resetVersion: nextVersion,
  };
}

export function parseAisbpPolicyState(metadata: Record<string, unknown> | undefined): AisbpPolicyStateV1 {
  if (!metadata || typeof metadata !== 'object') return emptyPolicyState();
  const raw = metadata[AISBP_POLICY_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyPolicyState();
  const o = raw as Record<string, unknown>;
  if (Number(o['v']) !== 1) return emptyPolicyState();

  const options = o['options'];
  const lastOpts = o['lastAssistantOptions'];
  const activeRaw = o['activeTopic'];
  const awaitingRaw = o['awaiting'];

  const awaiting: PolicyAwaiting =
    awaitingRaw === 'menu_category_selection'
      ? 'menu_category_selection'
      : awaitingRaw === 'option_selection'
      ? 'option_selection'
      : null;

  const sourceRaw = o['optionsSource'];
  const optionsSource: AisbpPolicyOptionMemoryEntry['source'] | null =
    sourceRaw === 'assistant_reply' || sourceRaw === 'policy_engine' ? sourceRaw : null;
  const derivedRaw = o['optionsDerivedFromChunkIds'];
  const optionsDerivedFromChunkIds = Array.isArray(derivedRaw)
    ? derivedRaw.filter((x): x is string => typeof x === 'string')
    : null;
  const tenantIdRaw = o['optionsTenantId'];

  return {
    v: 1,
    activeTopic: typeof activeRaw === 'string' ? activeRaw : null,
    awaiting,
    options:
      options && typeof options === 'object' && !Array.isArray(options)
        ? (options as Record<string, string>)
        : undefined,
    lastAssistantOptions:
      lastOpts && typeof lastOpts === 'object' && !Array.isArray(lastOpts)
        ? (lastOpts as Record<string, string>)
        : undefined,
    optionsUpdatedAt:
      typeof o['optionsUpdatedAt'] === 'string' ? (o['optionsUpdatedAt'] as string) : null,
    optionsSource,
    optionsDerivedFromChunkIds,
    optionsTenantId: typeof tenantIdRaw === 'string' && tenantIdRaw ? tenantIdRaw : null,
    expiresAt: typeof o['expiresAt'] === 'string' ? o['expiresAt'] : null,
    updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : null,
    memoryResetAt: typeof o['memoryResetAt'] === 'string' && o['memoryResetAt'] ? (o['memoryResetAt'] as string) : null,
    resetVersion:
      typeof o['resetVersion'] === 'number' && Number.isFinite(o['resetVersion'])
        ? (o['resetVersion'] as number)
        : undefined,
  };
}

export function mergePolicyIntoConversationMetadata(
  metadata: Record<string, unknown>,
  policy: AisbpPolicyStateV1,
): Record<string, unknown> {
  return {
    ...metadata,
    [AISBP_POLICY_METADATA_KEY]: policy,
  };
}

/** When false, menu/flow state is kept until the user changes topic (no time-only expiry). */
export function policyStateExpired(state: AisbpPolicyStateV1, nowMs: number): boolean {
  if (!state.expiresAt) return false;
  const t = Date.parse(state.expiresAt);
  if (Number.isNaN(t)) return false;
  return nowMs > t;
}

export function clearAwaitingState(state: AisbpPolicyStateV1): AisbpPolicyStateV1 {
  // Clears BOTH `options` and `lastAssistantOptions` so the option-resolver fallback path can't
  // resurrect stale choices after we've decided the memory is no longer trustworthy.
  return {
    ...state,
    awaiting: null,
    options: undefined,
    lastAssistantOptions: undefined,
    optionsUpdatedAt: null,
    optionsSource: null,
    optionsDerivedFromChunkIds: null,
    optionsTenantId: null,
    expiresAt: null,
    updatedAt: new Date().toISOString(),
  };
}

/** TTL for option memory: anything older than this is considered stale (24 hours). */
export const OPTION_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

export type OptionMemoryStaleReason =
  | 'prompt_updated_after_option_memory'
  | 'kb_updated_after_option_memory'
  | 'tenant_changed'
  | 'ttl_expired';

/**
 * Decide whether option memory is stale and should be discarded.
 *
 * Reasons:
 * - `prompt_updated_after_option_memory` — the active prompt config has been re-saved since the
 *   options were stored (covers "switched demo from restaurant to salon").
 * - `kb_updated_after_option_memory` — the tenant's KB has changed and the *options no longer
 *   match* current KB section titles (true contamination signal, not just any KB save).
 * - `tenant_changed` — the conversation now belongs to a different tenant than the option memory.
 * - `ttl_expired` — options older than {@link OPTION_MEMORY_TTL_MS} are dropped.
 */
export function shouldClearOptionMemory(
  state: AisbpPolicyStateV1,
  ctx: {
    promptConfigUpdatedAtIso?: string | null;
    kbDocumentUpdatedAtIso?: string | null;
    /** Current KB section titles — required to confirm KB-mismatch staleness. */
    currentKbSectionTitles?: string[];
    /** Current tenant id; if it differs from `state.optionsTenantId`, options are stale. */
    currentTenantId?: string | null;
    nowMs?: number;
  } = {},
): { stale: boolean; reason?: OptionMemoryStaleReason } {
  if (!state.options || Object.keys(state.options).length === 0) {
    return { stale: false };
  }

  // Tenant change is the strongest signal — kill memory regardless of timestamps.
  if (
    ctx.currentTenantId &&
    state.optionsTenantId &&
    state.optionsTenantId !== ctx.currentTenantId
  ) {
    return { stale: true, reason: 'tenant_changed' };
  }

  const optionsAt = state.optionsUpdatedAt ? Date.parse(state.optionsUpdatedAt) : NaN;
  if (Number.isNaN(optionsAt)) return { stale: false };

  if (ctx.promptConfigUpdatedAtIso) {
    const promptAt = Date.parse(ctx.promptConfigUpdatedAtIso);
    if (!Number.isNaN(promptAt) && promptAt > optionsAt) {
      return { stale: true, reason: 'prompt_updated_after_option_memory' };
    }
  }

  // KB updated after option memory AND option texts no longer match current KB section titles.
  if (ctx.kbDocumentUpdatedAtIso && Array.isArray(ctx.currentKbSectionTitles)) {
    const kbAt = Date.parse(ctx.kbDocumentUpdatedAtIso);
    if (!Number.isNaN(kbAt) && kbAt > optionsAt) {
      const titlesNorm = new Set(
        ctx.currentKbSectionTitles
          .map(t => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
          .filter(Boolean),
      );
      const optionTexts = Object.values(state.options).map(t => t.trim().toLowerCase());
      const anyMatch = optionTexts.some(t => titlesNorm.has(t));
      if (!anyMatch) {
        return { stale: true, reason: 'kb_updated_after_option_memory' };
      }
    }
  }

  const now = ctx.nowMs ?? Date.now();
  if (now - optionsAt > OPTION_MEMORY_TTL_MS) {
    return { stale: true, reason: 'ttl_expired' };
  }

  return { stale: false };
}
