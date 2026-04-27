import { stripCustomerFacingMeta, stripModelThinking } from '@aisbp/formatter';

/** Last-line defense before GHL send / DB outbound row — must match planner hygiene. */
export function sanitizeOutboundCustomerText(text: string): string {
  return stripCustomerFacingMeta(stripModelThinking(text ?? '')).trim();
}
