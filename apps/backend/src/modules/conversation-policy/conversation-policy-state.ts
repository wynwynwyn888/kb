/**
 * Conversation policy state in `conversations.metadata.aisbp_policy`.
 * Flows are invalidated by topic change (see policy engine), not by short timers.
 * Optional `expiresAt` is legacy-only; when null, state is kept until topic change.
 * No DB migration — uses existing JSON `metadata` column.
 */

export const AISBP_POLICY_METADATA_KEY = 'aisbp_policy';

export type PolicyAwaiting = 'menu_category_selection' | null;

export interface AisbpPolicyStateV1 {
  v: 1;
  activeTopic?: string | null;
  awaiting?: PolicyAwaiting;
  /** Option key → label (e.g. A → Starters) */
  options?: Record<string, string>;
  lastAssistantOptions?: Record<string, string>;
  expiresAt?: string | null;
  updatedAt?: string | null;
}

export function emptyPolicyState(): AisbpPolicyStateV1 {
  return { v: 1, activeTopic: null, awaiting: null, options: undefined, expiresAt: null, updatedAt: null };
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
  return {
    v: 1,
    activeTopic: typeof activeRaw === 'string' ? activeRaw : null,
    awaiting:
      o['awaiting'] === 'menu_category_selection' ? 'menu_category_selection' : null,
    options:
      options && typeof options === 'object' && !Array.isArray(options)
        ? (options as Record<string, string>)
        : undefined,
    lastAssistantOptions:
      lastOpts && typeof lastOpts === 'object' && !Array.isArray(lastOpts)
        ? (lastOpts as Record<string, string>)
        : undefined,
    expiresAt: typeof o['expiresAt'] === 'string' ? o['expiresAt'] : null,
    updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : null,
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
  return {
    ...state,
    awaiting: null,
    options: undefined,
    expiresAt: null,
    updatedAt: new Date().toISOString(),
  };
}
