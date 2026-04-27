/**
 * Restaurant booking vs other services — lexical guard (no external API).
 */

const OUT_OF_DOMAIN_SERVICE =
  /\b(face\s*wash|facial|facials|massage|haircut|hair\s*cut|clinic|doctor|dentist|car\s*wash|repair|spa\s*treatment|manicure|pedicure|waxing|botox|therapy\s*session)\b/i;

export type RestaurantBookingAssessment =
  | { inDomain: true }
  | { inDomain: false; matchedOutOfDomain?: string };

/**
 * True when message looks like a restaurant/table booking intent for this tenant.
 * Out-of-domain beauty/spa/auto/etc. with "book" should not run table-booking flows.
 */
export function assessRestaurantBookingMessage(message: string): RestaurantBookingAssessment {
  const t = message.trim();
  if (!t) return { inDomain: true };

  const out = OUT_OF_DOMAIN_SERVICE.exec(t);
  if (out?.[0]) {
    return { inDomain: false, matchedOutOfDomain: out[0] };
  }

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

export function extractOutOfDomainServicePhrase(message: string): string {
  const t = message.trim();
  const m = OUT_OF_DOMAIN_SERVICE.exec(t);
  if (m?.[0]) return m[0].replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 45)}...` : t;
}

export function outOfDomainBookingClarificationReply(
  tenantDisplayName: string,
  userPhraseSnippet: string,
): string {
  const name = tenantDisplayName.trim() || 'us';
  const phrase = userPhraseSnippet.trim() || 'that';
  return (
    `I can help with ${name} reservations, but I'm not sure what you mean by "${phrase}". ` +
    `Are you trying to book a table at ${name}, or is this for another service?`
  );
}

export function bookingAskPreferredDateTimeReply(guestCount: number | null): string {
  if (guestCount != null && guestCount > 0) {
    return `Got it, ${guestCount} guests. What date and time would you prefer?`;
  }
  return `Sure, I can help with that. What date and time would you prefer?`;
}
