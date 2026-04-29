import { stripCustomerFacingMeta, stripModelThinking } from '@aisbp/formatter';
import {
  prepareCustomerFacingPlainTextForOutboundSplit,
  stripLiveCustomerMarkdownForOutbound,
} from './customer-facing-live-format';
import { maybeCoalesceOutboundBubbles } from './outbound-coalesce';
import { packPlainTextIntoOutboundBubbles } from './outbound-bubbles';

/**
 * Mirrors the live ReplyPlanner → OutboundSendService pipeline for "Test your bot".
 *
 * Drift note: preview never calls GHL. Live sends may coalesce multiple logical bubbles into
 * one physical message when the joined body is under the WhatsApp-safe cap — same rule as
 * `OutboundSendService.maybeCoalesceOutboundBubbles` so paragraph spacing matches what the
 * customer sees on WhatsApp (blank lines between list and follow-up question are not "lost"
 * between separate message bubbles).
 */
export function formatLiveCustomerDraftForPreview(raw: string): string {
  const stripped = stripLiveCustomerMarkdownForOutbound(
    stripCustomerFacingMeta(stripModelThinking(raw ?? '')),
  );
  const prepared = prepareCustomerFacingPlainTextForOutboundSplit(stripped);
  const bubbles = packPlainTextIntoOutboundBubbles(prepared);
  const physical = maybeCoalesceOutboundBubbles(bubbles.map(b => ({ index: b.index, text: b.text })));
  return physical.map(b => b.text).join('\n\n');
}
