/**
 * Removes pushy “connect/speak with the team” CTAs from outbound customer text when the
 * conversation is not an explicit handover, complaint, or similar escalation context.
 */

import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import { detectComplaintServiceIssue } from './outbound-safety-governor';

export type ProactiveHandoverCtaRemovedLog = {
  tenantId: string;
  conversationId: string;
  latestIntent: ConversationIntent;
  reason: string;
};

export function allowsProactiveTeamConnectLanguage(params: {
  latestIntent: ConversationIntent;
  latestUserMessage?: string;
  combinedHumanMessagesText?: string;
}): boolean {
  if (params.latestIntent === 'HUMAN_HANDOVER' || params.latestIntent === 'COMPLAINT') {
    return true;
  }
  const probe = [params.combinedHumanMessagesText, params.latestUserMessage]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n')
    .trim();
  if (probe && detectComplaintServiceIssue(probe).triggered) {
    return true;
  }
  return false;
}

function sentenceContainsProactiveHandoverCta(sentence: string): boolean {
  const t = sentence.toLowerCase();
  return (
    t.includes('connect you with the team') ||
    t.includes('connect you to the team') ||
    t.includes('speak with the team') ||
    /\bteam will assist\b/i.test(sentence) ||
    /\bhuman agent\b/i.test(sentence) ||
    /\brepresentative\b/i.test(sentence)
  );
}

/** Split into rough sentences for CTA removal (period / ! / ?). */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function stripProactiveHandoverCtaIfNeeded(params: {
  replyText: string;
  latestIntent: ConversationIntent;
  latestUserMessage?: string;
  combinedHumanMessagesText?: string;
}): { text: string; removed: boolean; reason?: string } {
  const raw = params.replyText.trim();
  if (!raw) {
    return { text: params.replyText, removed: false };
  }

  if (allowsProactiveTeamConnectLanguage(params)) {
    return { text: params.replyText, removed: false };
  }

  const sentences = splitSentences(raw);
  if (sentences.length === 0) {
    return { text: params.replyText, removed: false };
  }

  const kept = sentences.filter(s => !sentenceContainsProactiveHandoverCta(s));
  if (kept.length === sentences.length) {
    return { text: params.replyText, removed: false };
  }

  const text = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return {
    text: text.length > 0 ? text : 'How can I help you further?',
    removed: true,
    reason: 'removed_sentences_with_proactive_handover_cta',
  };
}
