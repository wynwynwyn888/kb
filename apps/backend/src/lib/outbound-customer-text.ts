import { stripCustomerFacingMeta, stripModelThinking } from '@aisbp/formatter';

/** Model placeholder / template leaks — replace entire bubble with a safe honest line. */
const PLACEHOLDER_LEAK =
  /\[(?:insert|todo|tbd|fixme|placeholder)|\bTODO\b|\bplaceholder\b|exact address here/i;

export const OUTBOUND_PLACEHOLDER_FALLBACK =
  "I don't have the exact address on hand. Let me get the team to confirm it for you.";

/** Last-line defense before GHL send / DB outbound row — must match planner hygiene. */
export function sanitizeOutboundCustomerText(text: string): string {
  let t = stripCustomerFacingMeta(stripModelThinking(text ?? '')).trim();
  if (PLACEHOLDER_LEAK.test(t)) {
    return OUTBOUND_PLACEHOLDER_FALLBACK;
  }
  return t;
}
