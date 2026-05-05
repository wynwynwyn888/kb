import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';

/** Intents where KB should always run regardless of brevity (includes menu/service-ish). */
const KB_ALWAYS_INTENTS: ReadonlySet<ConversationIntent> = new Set([
  'PRICE',
  'LOCATION',
  'BOOKING',
  'COMPLAINT',
  'BUSINESS_HOURS',
  'MENU',
]);

export function inboundWordCount(trimmedLatestMessage: string): number {
  const t = trimmedLatestMessage.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/**
 * Cheap policy / legalese signals — behave like SERVICE/POLICY in the KB gate.
 */
export function looksLikeKbPolicyTopicMessage(message: string): boolean {
  return /\b(policy|policies|deposit|deposits|refunds?|cancellation|cancellations|terms|T&C|TnC)\b/i.test(
    message.trim(),
  );
}

/**
 * Skip KB retrieval for very short replies that continue an active topic.
 * SHORT_SELECTION / CONFIRMATION / GREETING are excluded so anchors and acks behave normally.
 */
export function shouldSkipKbShortFollowUpActiveTopic(params: {
  latestMessageTrimmed: string;
  latestIntent: ConversationIntent;
  activeTopic: string | null | undefined;
  /** When true (menu pick + expansion), retrieval query may not be literal user line — never skip via this gate. */
  menuSelectionAnchorActive: boolean;
}): boolean {
  const topic = params.activeTopic;
  if (topic == null || String(topic).trim() === '') return false;

  if (
    params.latestIntent === 'SHORT_SELECTION' ||
    params.latestIntent === 'CONFIRMATION' ||
    params.latestIntent === 'GREETING'
  ) {
    return false;
  }

  if (params.menuSelectionAnchorActive) return false;

  if (KB_ALWAYS_INTENTS.has(params.latestIntent)) return false;

  if (looksLikeKbPolicyTopicMessage(params.latestMessageTrimmed)) return false;

  return inboundWordCount(params.latestMessageTrimmed) <= 12;
}
