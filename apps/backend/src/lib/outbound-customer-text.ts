import { stripCustomerFacingMeta, stripModelThinking } from '@aisbp/formatter';

/** Model placeholder / template leaks — replace entire bubble with a safe honest line. */
const PLACEHOLDER_LEAK =
  /\[(?:insert|todo|tbd|fixme|placeholder)|\bTODO\b|\bplaceholder\b|exact address here/i;

/** Known tutorial / eval bait strings — never customer-safe as a location answer. */
const ADDRESS_HALLUCINATION_BAIT =
  /\b123\s+Hair\s+Avenue\b|\bHair\s+Station\b|\bnearest\s+MRT\s+station\s+is\s+Hair\s+Station\b|\[Insert exact address here\]/i;

export const OUTBOUND_PLACEHOLDER_FALLBACK =
  "I don't have the exact address on hand. Let me get the team to confirm it for you.";

/** Last-line defense before GHL send / DB outbound row — must match planner hygiene. */
export function sanitizeOutboundCustomerText(text: string): string {
  let t = stripCustomerFacingMeta(stripModelThinking(text ?? '')).trim();
  if (PLACEHOLDER_LEAK.test(t)) {
    return OUTBOUND_PLACEHOLDER_FALLBACK;
  }
  if (ADDRESS_HALLUCINATION_BAIT.test(t)) {
    return OUTBOUND_PLACEHOLDER_FALLBACK;
  }
  return t;
}
