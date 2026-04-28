/**
 * Generic booking helpers — no business-specific allow/deny lists.
 *
 * The previous implementation hard-coded a "table booking" assumption and rejected services
 * like haircut/facial/massage as out-of-domain. That was incorrect for a universal chatbot
 * platform, where the *same* helpers must serve restaurants, salons, clinics, spas, gyms, etc.
 *
 * The current behaviour:
 * - `assessRestaurantBookingMessage` always returns `inDomain: true` and is kept as a no-op
 *   compatibility shim (the name is preserved so the rest of the code keeps compiling). New code
 *   should not branch on it.
 * - Helpers like guest-count extraction and "ask date/time" copy remain useful and generic.
 */

export type RestaurantBookingAssessment =
  | { inDomain: true }
  | { inDomain: false; matchedOutOfDomain?: string };

/**
 * @deprecated In a universal chatbot platform, booking validity is decided by the tenant's KB
 * + LLM, not by a hardcoded service allow-list. This shim always reports `inDomain: true`.
 */
export function assessRestaurantBookingMessage(_message: string): RestaurantBookingAssessment {
  return { inDomain: true };
}

export function extractGuestCountHint(message: string): number | null {
  const t = message.toLowerCase();
  const pax = t.match(/\b(\d+)\s*(pax|guests?|people|persons?|covers?)\b/);
  if (pax?.[1]) return Math.min(99, Math.max(1, parseInt(pax[1]!, 10)));
  const forN = t.match(/\bfor\s+(\d+)\b/);
  if (forN?.[1]) return Math.min(99, Math.max(1, parseInt(forN[1]!, 10)));
  const party = t.match(/\bparty\s*of\s*(\d+)\b/);
  if (party?.[1]) return Math.min(99, Math.max(1, parseInt(party[1]!, 10)));
  return null;
}

/** @deprecated Retained for callers that still reference the old name. */
export function extractOutOfDomainServicePhrase(message: string): string {
  const t = message.trim();
  return t.length > 48 ? `${t.slice(0, 45)}...` : t;
}

/** @deprecated Returns a generic "let's confirm what you'd like to book" copy now. */
export function outOfDomainBookingClarificationReply(
  tenantDisplayName: string,
  userPhraseSnippet: string,
): string {
  const name = tenantDisplayName.trim() || 'us';
  const phrase = userPhraseSnippet.trim() || 'that';
  return (
    `Happy to help with bookings at ${name}. Could you tell me a little more about "${phrase}" — ` +
    `what service or visit are you trying to book, and for when?`
  );
}

export function bookingAskPreferredDateTimeReply(guestCount: number | null): string {
  if (guestCount != null && guestCount > 0) {
    return `Got it, ${guestCount} guests. What date and time would you prefer?`;
  }
  return `Sure, I can help with that. What date and time would you prefer?`;
}
