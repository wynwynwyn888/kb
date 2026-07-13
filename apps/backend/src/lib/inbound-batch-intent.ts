import {
  classifyConversationIntent,
  type ConversationIntent,
} from '../modules/conversation-policy/conversation-intent';

/** Lower = higher priority for `primaryIntent` when multiple lines arrive in one debounced batch. */
const INTENT_PRIORITY: Record<ConversationIntent, number> = {
  COMPLAINT: 1,
  HUMAN_HANDOVER: 1,
  BOOKING: 2,
  PRICE: 3,
  BUSINESS_HOURS: 3,
  LOCATION: 3,
  EXPLICIT_OPT_OUT: 1,
  SHORT_SELECTION: 4,
  UNKNOWN: 5,
  CONFIRMATION: 5,
  HESITATION: 5,
  MENU: 6,
  GREETING: 7,
};

function rankOf(i: ConversationIntent): number {
  return INTENT_PRIORITY[i] ?? 50;
}

export interface InboundBatchIntentSummary {
  orderedMessages: string[];
  combinedText: string;
  intentsPerMessage: ConversationIntent[];
  primaryIntent: ConversationIntent;
  secondaryIntents: ConversationIntent[];
  /** Distinct intents across the batch (diagnostics). */
  combinedIntentCount: number;
  conflictingIntents: boolean;
  /** Inbound lines in this batch (each line is a surface “question” to cover when possible). */
  answerableIntentCount: number;
}

function pickPrimaryIntent(intents: ConversationIntent[]): ConversationIntent {
  if (intents.length === 0) return 'UNKNOWN';
  let best = intents[0]!;
  let bestRank = rankOf(best);
  let bestIdx = 0;
  intents.forEach((intent, idx) => {
    const r = rankOf(intent);
    if (r < bestRank || (r === bestRank && idx < bestIdx)) {
      best = intent;
      bestRank = r;
      bestIdx = idx;
    }
  });
  return best;
}

/**
 * Build a stable combined representation of a debounced inbound batch (oldest → newest).
 */
export function summarizeInboundTextBatch(orderedMessages: string[]): InboundBatchIntentSummary {
  const messages = orderedMessages.map(m => m.trim()).filter(Boolean);
  const intentsPerMessage = messages.map(m => classifyConversationIntent(m));
  const primaryIntent = pickPrimaryIntent(intentsPerMessage);
  const uniq = [...new Set(intentsPerMessage)];
  const secondaryIntents = uniq.filter(i => i !== primaryIntent);
  const conflictingIntents =
    uniq.includes('COMPLAINT') &&
    (uniq.includes('BOOKING') || uniq.includes('MENU') || uniq.includes('PRICE'));
  const combinedText = messages.join('\n\n');

  return {
    orderedMessages: messages,
    combinedText,
    intentsPerMessage,
    primaryIntent,
    secondaryIntents,
    combinedIntentCount: uniq.length,
    conflictingIntents,
    answerableIntentCount: messages.length,
  };
}
