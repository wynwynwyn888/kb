/**
 * Coalesce multiple outbound reply bubbles into one physical send when the joined body still
 * fits WhatsApp-style limits. Preserves `\n\n` between former bubbles so paragraph spacing
 * can match a single-block preview.
 *
 * **Channel policy:** `OutboundSendService` skips this for `conversations.channel === WHATSAPP`
 * unless `WHATSAPP_COALESCE_BUBBLES=true`. Other channels still call this helper by default.
 */

export const WHATSAPP_SAFE_SINGLE_MESSAGE_MAX = 3800;

export type OutboundBubbleLike = { index: number; text: string };

/**
 * If there are 2–3 bubbles and their `\n\n`-joined length is within the safe cap, return a single
 * bubble containing the joined text. Otherwise return the input unchanged.
 */
export function maybeCoalesceOutboundBubbles(bubbles: OutboundBubbleLike[]): OutboundBubbleLike[] {
  if (bubbles.length <= 1) return bubbles;
  const joined = bubbles.map(b => b.text).join('\n\n');
  if (joined.length > WHATSAPP_SAFE_SINGLE_MESSAGE_MAX) return bubbles;
  return [{ index: 0, text: joined }];
}
