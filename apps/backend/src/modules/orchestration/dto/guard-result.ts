// Runtime guard result — explicit guard check outcomes

export type GuardDecision =
  | 'PROCEED'
  | 'SKIP_BOT_DISABLED'
  | 'SKIP_GHL_DISCONNECTED'
  | 'SKIP_HANDOVER_ACTIVE'
  | 'SKIP_QUOTA_EXHAUSTED'
  | 'SKIP_UNSUPPORTED_MESSAGE_TYPE'
  | 'SKIP_UNSUPPORTED_CHANNEL'
  | 'SKIP_DUPLICATE'
  | 'ERROR';

export interface GuardResult {
  decision: GuardDecision;
  reason?: string;
  guardName: string;
}

// Meta_guard that aggregates multiple guard results
export interface GuardOutcome {
  final: GuardDecision;
  guards: GuardResult[];
}
