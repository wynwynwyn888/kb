// Orchestration result — the final output of the orchestration pipeline
// This is what the inbound-message processor receives back.

import type { GuardOutcome } from './guard-result';
import type { RoutingResponse } from './routing-response';
import type { ReplyDecision } from '../../reply-planning/dto';

// These match the Prisma OrchestrationOutcome enum
export type OrchestrationOutcome =
  | 'PROCEED'
  | 'SKIP_BOT_DISABLED'
  | 'SKIP_GHL_DISCONNECTED'
  | 'SKIP_HANDOVER_ACTIVE'
  | 'SKIP_QUOTA_EXHAUSTED'
  | 'SKIP_UNSUPPORTED_MESSAGE_TYPE'
  | 'SKIP_UNSUPPORTED_CHANNEL'
  | 'SKIP_DUPLICATE'
  | 'ERROR';

export interface OrchestrationResult {
  success: boolean;
  outcome: GuardOutcome['final'];
  conversationId: string;
  webhookEventId?: string;
  guards: GuardOutcome;
  routing?: RoutingResponse;
  replyPlan?: ReplyDecision;
  logId?: string;
  error?: string;
}
