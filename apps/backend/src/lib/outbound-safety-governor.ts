/**
 * Outbound safety / conversation governor — pure helpers for pre-send checks.
 * Blocks unsafe booking claims, menu noise, and supports complaint/scope detection in orchestration.
 */

import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import { detectMenuIntentInMessage } from './kb-relevance';

export const SAFE_PENDING_BOOKING_REPLY =
  "I've noted those details. Our team will confirm the appointment availability with you before anything is locked in.";

/**
 * Claims that imply the calendar slot is already committed for the customer.
 * Intentionally narrow: tentative / team-will-confirm wording must NOT match here.
 */

const BOOKING_CLAIM_HINT = /\b(appointment|appointments|booking|bookings|slot|slots|reservation|calendar)\b/i;

function excludesNonCommittedBookingTone(t: string): boolean {
  if (/\bour\s+team\s+(?:can|will|may)\s+confirm\b/i.test(t)) return true;
  if (/\b(?:we|our\s+team)\s+(?:can|will|may)\s+confirm\b/i.test(t)) return true;
  if (/\bconfirm\s+(?:the\s+)?(?:transport\s+)?fee\b/i.test(t)) return true;
  if (/\btransport\s+fee\b/i.test(t) && /\bconfirm\b/i.test(t)) return true;
  if (/don['’]t\s+have\s+(?:the\s+)?exact\s+fee\b/i.test(t)) return true;
  if (/i\s+don['’]t\s+have\s+the\s+exact\s+fee\b/i.test(t)) return true;
  if (/not\s+sure\s+about\s+(?:the\s+)?(?:fee|fees|price|pricing)/i.test(t)) return true;
  return false;
}

const BOOKING_COMMITTED_PATTERNS: RegExp[] = [
  /\b(?:your\s+(?:appointment|slot|booking)|the\s+(?:appointment|booking))\s+(?:is\s+|has\s+been\s+)?confirmed\b/i,
  /\bbooking\s+is\s+confirmed\b/i,
  /\byour\s+slot\s+has\s+been\s+booked\b/i,
  /\byour\s+slot\s+is\s+booked\b/i,
  /\b(?:i['’]ve|i\s+have)\s+booked\s+(?:you|your)\b/i,
  /\b(?:i['’]ve|i\s+have)\s+booked\s+you\s+for\b/i,
  /\bappointment\s+has\s+been\s+booked\b/i,
  /\bappointment\s+is\s+booked\b/i,
  /\breserved\s+your\s+(?:slot|appointment|booking)\b/i,
  /(?:booking|appointment|reservation)\s+finalized\b/i,
  /\bfinalize[ds]?\s+(?:your\s+)?(?:booking|appointment|reservation)\b/i,
  /\bi['’]ll\s+proceed\s+with\s+booking\b/i,
  /\bplease\s+arrive\s+for\s+your\s+appointment\b/i,
];

export function textClaimsBookingConfirmed(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (excludesNonCommittedBookingTone(t)) return false;

  if (BOOKING_COMMITTED_PATTERNS.some(p => p.test(t))) return true;

  if (/\bi\s+booked\b/i.test(t)) {
    if (/\b(i\s+booked)\s+(?:this|that|it|here)\b/i.test(t)) return false;
    return BOOKING_CLAIM_HINT.test(t);
  }

  if (/\bconfirmed\s+for\b/i.test(t) && BOOKING_CLAIM_HINT.test(t)) return true;

  return false;
}

/**
 * `action_intents.source` values that mark a trusted EXECUTED calendar booking for confirmation wording.
 * Legacy `WHATSAPP_BOOKING:` prefix is accepted for backward compatibility; `AI` covers deferred executor paths.
 */
export function isTrustedExecutedBookSlotSource(source: string | null | undefined): boolean {
  const s = typeof source === 'string' ? source.trim() : '';
  if (!s) return true;
  if (s === 'AI') return true;
  return s.startsWith('CONVERSATION_BOOKING:') || s.startsWith('WHATSAPP_BOOKING:');
}

export type ComplaintServiceIssue = {
  triggered: boolean;
  reason: string;
  colourRelated: boolean;
  /** Tag names to queue for GHL (lowercase, snake_case) */
  tags: string[];
};

const COMPLAINT_PATTERNS: { re: RegExp; reason: string; colour: boolean }[] = [
  { re: /\buneven\b/i, reason: 'uneven_result', colour: true },
  { re: /\bunhappy\s+with\s+(my\s+)?(colour|color|results?)\b/i, reason: 'unhappy_with_colour', colour: true },
  { re: /\b(colou?r|results?)\s+looks?\s+wrong\b/i, reason: 'colour_looks_wrong', colour: true },
  { re: /\bhaircut\s+too\s+short\b/i, reason: 'haircut_too_short', colour: false },
  { re: /\b(damaged|breaking)\s+after\s+(the\s+)?(treatment|service|colour|color)\b/i, reason: 'damaged_after_service', colour: true },
  { re: /\bcomplaint\b/i, reason: 'complaint_keyword', colour: false },
  { re: /\brefund\b/i, reason: 'refund', colour: false },
  { re: /\bfix\s+my\s+hair\b/i, reason: 'fix_my_hair', colour: false },
  { re: /\bnot\s+happy\s+with\s+(the\s+)?(result|service|colour|color)\b/i, reason: 'not_happy_with_result', colour: true },
  { re: /\ballergic\s+reaction\s+after\s+(the\s+)?(service|treatment|colour|color)\b/i, reason: 'allergic_after_service', colour: true },
  { re: /\b(result|colour|color)\s+looks?\s+uneven\b/i, reason: 'result_uneven', colour: true },
];

export function detectComplaintServiceIssue(raw: string): ComplaintServiceIssue {
  const t = raw.trim();
  if (!t) {
    return { triggered: false, reason: 'none', colourRelated: false, tags: [] };
  }
  for (const p of COMPLAINT_PATTERNS) {
    if (p.re.test(t)) {
      const tags = ['needs_human_review', 'complaint_service_issue'];
      if (p.colour) tags.push('complaint_colour');
      return { triggered: true, reason: p.reason, colourRelated: p.colour, tags: [...new Set(tags)] };
    }
  }
  return { triggered: false, reason: 'none', colourRelated: false, tags: [] };
}

/** Non-hair / out-of-salon-scope questions where prior colour topic should not drive recommendations. */
const OUT_OF_SCOPE_SALON: RegExp[] = [
  /\bneck\s+massage\b/i,
  /\b(do\s+you\s+do|do\s+you\s+offer)\s+([a-z]+\s+){0,3}massage\b/i,
  /\bfull[\s-]*body\s+massage\b/i,
  /\bmanicure\b/i,
  /\bpedi(cure)?\b/i,
  /\beyebrow(s)?\s+(tattoo|microblad)\b/i,
];

export function isUnsupportedSalonScopeQuery(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return OUT_OF_SCOPE_SALON.some(r => r.test(t));
}

const MENU_ASK = /\b(menu|categories|category|options?|what\s+do\s+you\s+offer|list\s+of\s+services|book\s+from\s+the\s+menu)\b/i;
const ALTERNATIVE_ASK =
  /\b(any\s+other|what\s+else|alternatives?|other\s+options?|something\s+else|instead|recommend(ation)?s?\s+for\s+colou?r|other\s+colou?r\s+options?)\b/i;

export function userAskedForMenuOrOptions(latestInbound: string, latestIntent: ConversationIntent): boolean {
  if (latestIntent === 'MENU' || latestIntent === 'SHORT_SELECTION') return true;
  const t = latestInbound.trim();
  if (!t) return false;
  if (MENU_ASK.test(t)) return true;
  return false;
}

export function userAskedForColourAlternatives(latestInbound: string): boolean {
  return ALTERNATIVE_ASK.test(latestInbound.trim());
}

/**
 * Heuristic: multiple bullet/numbered lines or long multi-section list looks like a menu dump.
 */
export function looksLikeMenuCategoryBlock(text: string): boolean {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const bulletLines = lines.filter(
    l => /^\s*[-•*●]+\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l) || /^\s*[A-Da-d][.)]\s+/.test(l),
  );
  if (bulletLines.length >= 3) return true;
  const sectiony =
    /\b(categories?|our\s+services|choose\s+from|colour|color|treatment|styling|cuts?)\b/i.test(text) &&
    lines.length >= 6;
  return sectiony;
}

const CONCERN_HINTS = /\b(oily|greasy|dry|scalp|ends|frizz|damage|dull|itchy|flaky|split)\b/i;

export function shouldRewriteUnrequestedMenuRepetition(params: {
  replyText: string;
  latestInboundText: string;
  latestIntent: ConversationIntent;
}): boolean {
  const { replyText, latestInboundText, latestIntent } = params;
  if (userAskedForMenuOrOptions(latestInboundText, latestIntent)) return false;
  if (!CONCERN_HINTS.test(latestInboundText)) return false;
  return looksLikeMenuCategoryBlock(replyText);
}

export const UNREQUESTED_MENU_FALLBACK_REPLY =
  'Thanks for the detail — for oily roots with dry ends, we usually focus on balancing/cleansing at the scalp while adding moisture and repair from mid-lengths through ends (without weighing hair down). ' +
  'If you can share how quickly your roots get oily after washing and whether your ends feel brittle or mainly dry, I can narrow the best next step.';

/**
 * No-KB business-claim guard:
 * When KB retrieval is empty/weak, block hallucinated business-specific claims (breeds accepted,
 * services offered, prices, opening hours, availability, policies, medical/suitability advice).
 * Returns a safe uncertainty reply when a risky claim is detected.
 */
export const SAFE_UNSUPPORTED_BUSINESS_CLAIM_REPLY =
  "I don’t have that specific detail confirmed here. Could you share a little more so I can guide you safely?";

export const NO_KB_FALLBACK_MENU_SERVICE_LIST =
  "I don’t have the full service list confirmed here. Could you share what you’re looking for so I can guide you better?";

export const NO_KB_FALLBACK_BROAD_SERVICE =
  "I don’t have the full service list confirmed here. Could you share what you’re looking for so I can guide you better?";

export const NO_KB_FALLBACK_BREED_OR_SPECIES_SERVICE =
  "I can help with grooming enquiries, but I don’t have breed-specific details confirmed here. Could you share a bit more about what you need?";

export const NO_KB_FALLBACK_PRICE =
  "I don’t have confirmed pricing here. Could you let me know which service you’re asking about?";

export const NO_KB_FALLBACK_HOURS = "I don’t have the confirmed opening hours here.";

export const NO_KB_FALLBACK_AVAILABILITY =
  "I don’t have live availability here. Could you share your preferred date and time?";

const BUSINESS_ASSERTION = /\b(we|our\s+(team|clinic|shop|salon)|yes,?\s+we)\b/i;
/** Welcomes / acceptance claims that do not literally include "we …" but are still unsafe without KB. */
const STANDALONE_WELCOME_ALL_BREEDS = /\b(all\s+breeds\s+are\s+welcome|welcome\s+all\s+breeds)\b/i;
const CLAIM_BREED_SPECIES =
  /\b(breed|breeds|chihuahua|pomeranian|bulldog|labrador|retriever|poodle|cat|cats|dog|dogs|puppy|puppies|pet|pets|all\s+breeds|any\s+breed|furkid|fur\s*kids?)\b/i;
const CLAIM_ACCEPT_OFFER =
  /\b(accept|welcome|allow|can\s+take|we\s+do|we\s+offer|provide|available|availability)\b/i;
const CLAIM_PRICING =
  /\b(price|pricing|cost|fee|charge|usd|sgd|rm|eur|gbp)\b|\$\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:usd|sgd|rm)/i;
const CLAIM_HOURS = /\b(open|opening|close|closing|hours?|am|pm)\b/i;
const CLAIM_POLICY = /\b(policy|refund|cancellation|cancel|reschedule)\b/i;
const CLAIM_MEDICAL = /\b(doctor|vet|medical|diagnos(e|is)|treat(ment)?|medication|prescribe)\b/i;

export type UnsupportedClaimRewriteLog = {
  reason: string;
  latestIntent: ConversationIntent;
  kbChunksLength: number;
  patternGroup?: string;
};

export type UnsupportedClaimSupportCheckLog = {
  tenantId: string;
  conversationId: string;
  claimType: 'price';
  supportSource: 'kb' | 'business_notes' | 'unsupported';
  kbChunksLength: number;
  latestIntent: ConversationIntent;
};

/** Tokens too generic to alone anchor a priced line against tenant corpus. */
const PRICE_GROUNDING_GENERIC_WORDS = new Set([
  'treatment',
  'treatments',
  'service',
  'services',
  'offer',
  'offers',
  'offered',
  'starting',
  'starts',
  'start',
  'package',
  'packages',
  'session',
  'sessions',
  'book',
  'booking',
]);

export function replyContainsCustomerFacingPriceClaims(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /\$\s*\d+(?:\.\d{1,2})?/i.test(t) || /\bfrom\s+\$\s*\d+/i.test(t);
}

export function priceClaimsGroundedInTenantSources(replyText: string, corpusRaw: string): boolean {
  const corpus = corpusRaw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!corpus) return false;
  if (!replyContainsCustomerFacingPriceClaims(replyText)) return false;

  const segments = replyText.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const pricedSegments = segments.filter(seg => /\$\s*\d+/i.test(seg));
  if (pricedSegments.length === 0) return false;

  for (const seg of pricedSegments) {
    const amounts = [...seg.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/gi)].map(m => m[1]!);
    if (amounts.length === 0) continue;

    for (const amt of amounts) {
      const dollarish =
        corpus.includes(`$${amt}`) ||
        corpus.includes(`$ ${amt}`) ||
        corpus.includes(`from $${amt}`) ||
        corpus.includes(`from $ ${amt}`) ||
        new RegExp(`\\$\\s*${amt}\\b`).test(corpus);
      if (!dollarish) return false;
    }

    const words = seg.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const anchors = words.filter(w => !PRICE_GROUNDING_GENERIC_WORDS.has(w));
    const anchored = anchors.some(w => corpus.includes(w));
    const loosely = words.some(w => corpus.includes(w));
    if (!anchored && !loosely) return false;
  }

  return true;
}

function supportCheckPriceBase(params: {
  tenantId?: string;
  conversationId?: string;
  kbChunksLength: number;
  latestIntent: ConversationIntent;
}): Omit<UnsupportedClaimSupportCheckLog, 'supportSource'> {
  return {
    tenantId: params.tenantId?.trim() || 'n/a',
    conversationId: params.conversationId?.trim() || 'n/a',
    claimType: 'price',
    kbChunksLength: params.kbChunksLength,
    latestIntent: params.latestIntent,
  };
}

export function userMessageSuggestsBreedOrSpeciesServiceQuery(message: string): boolean {
  const raw = message.trim();
  if (!raw) return false;
  const m = raw.toLowerCase();
  if (/\b(grooming|groom|wash|spa)\s+for\s+/i.test(raw)) return true;
  if (/\b(can\s+my\s+\w+|bring\s+my|bring\s+(?:a\s+)?(?:chihuahua|dog|puppy))\b/i.test(m)) return true;
  if (/\bfor\s+my\s+(?:dog|cat|puppy)\b/i.test(m)) return true;
  if (
    /\b(chihuahua|labrador|poodle|pug|terrier|shepherd|retriever|bulldog|breed)\b/i.test(m) &&
    /\b(groom|grooming|service|spa|skin|coat)\b/i.test(m)
  ) {
    return true;
  }
  if (/\b(skin\s+issue|sensitive\s+skin)\b/i.test(m) && /\b(groom|grooming)\b/i.test(m)) return true;
  return false;
}

function replySuggestsUnsupportedBreedOrPackageRecommendation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b(typically\s+recommend|we\s+typically|recommend\s+our|essential\s+grooming|our\s+essential)\b/i.test(t)) {
    return true;
  }
  if (/\bwe\s+recommend\b/i.test(t) && /\b(grooming|package|service|spa|treatment|essential)\b/i.test(t)) {
    return true;
  }
  if (
    /\bfor\s+(?:a\s+)?(?:labrador|golden\s+retriever|chihuahua|poodle|your\s+puppy|your\s+dog),\s*(?:we\s+)?(?:usually|typically|recommend)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function userAskedBroadServiceBrowseQuery(message: string, intent: ConversationIntent): boolean {
  const raw = message.trim();
  if (!raw) return false;
  if (/^(grooming|daycare|spa)\??$/i.test(raw)) return true;
  if (/\b(menu\s+pls|menu\s+plz|what\s+services?\s+do\s+you|what\s+do\s+you\s+offer|service\s+list|list\s+of\s+services)\b/i.test(raw)) {
    return true;
  }
  if (intent === 'MENU' && /\b(what\s+service|your\s+menu)\b/i.test(raw)) return true;
  return false;
}

function resolveRiskyPatternGroup(replyText: string): string {
  if (CLAIM_BREED_SPECIES.test(replyText) && CLAIM_ACCEPT_OFFER.test(replyText)) return 'breed_acceptance';
  if (CLAIM_PRICING.test(replyText) && CLAIM_ACCEPT_OFFER.test(replyText)) return 'pricing';
  if (CLAIM_HOURS.test(replyText) && (/\bwe\s*(are|'re)\s*open\b/i.test(replyText) || /\bopen\s+(from|until|at)\b/i.test(replyText))) {
    return 'hours_availability_claim';
  }
  if (CLAIM_POLICY.test(replyText) && CLAIM_ACCEPT_OFFER.test(replyText)) return 'policy';
  if (CLAIM_MEDICAL.test(replyText)) return 'medical';
  return 'general';
}

function pickIntentAwareNoKbFallback(
  intent: ConversationIntent,
  userMessage: string,
  replyText: string,
): string {
  const primary = userMessage.trim();
  const probe = primary || replyText.trim();

  if (
    !primary &&
    CLAIM_BREED_SPECIES.test(replyText) &&
    CLAIM_ACCEPT_OFFER.test(replyText)
  ) {
    return NO_KB_FALLBACK_BREED_OR_SPECIES_SERVICE;
  }

  const ml = probe.toLowerCase();

  if (
    (CLAIM_BREED_SPECIES.test(userMessage) || userMessageSuggestsBreedOrSpeciesServiceQuery(userMessage)) &&
    CLAIM_BREED_SPECIES.test(replyText) &&
    CLAIM_ACCEPT_OFFER.test(replyText)
  ) {
    return NO_KB_FALLBACK_BREED_OR_SPECIES_SERVICE;
  }

  if (userAskedBroadServiceBrowseQuery(probe, intent)) {
    return NO_KB_FALLBACK_BROAD_SERVICE;
  }

  if (intent === 'PRICE' || /\b(how\s+much|price|pricing|cost|fee|charge)\b/i.test(ml)) {
    return NO_KB_FALLBACK_PRICE;
  }

  if (
    intent === 'BUSINESS_HOURS' ||
    (/\b(open|opening|close|closing|hours?)\b/i.test(ml) && !detectMenuIntentInMessage(probe))
  ) {
    return NO_KB_FALLBACK_HOURS;
  }

  if (
    intent === 'BOOKING' ||
    /\b(slot|slots|availability|available\s+(?:slot|appointment|time)|next\s+available)\b/i.test(ml)
  ) {
    return NO_KB_FALLBACK_AVAILABILITY;
  }

  if (intent === 'MENU' || detectMenuIntentInMessage(probe)) {
    return NO_KB_FALLBACK_MENU_SERVICE_LIST;
  }

  return SAFE_UNSUPPORTED_BUSINESS_CLAIM_REPLY;
}

export function rewriteUnsupportedBusinessClaimsWhenNoKb(params: {
  replyText: string;
  kbChunksReturned: number;
  latestIntent?: ConversationIntent;
  latestUserMessage?: string;
  tenantId?: string;
  conversationId?: string;
  /** Business notes + tenant system prompt text used to ground explicit $ prices when KB is empty. */
  tenantPricingCorpus?: string;
}): {
  rewritten: boolean;
  text: string;
  reason?: string;
  log?: UnsupportedClaimRewriteLog;
  supportCheckLog?: UnsupportedClaimSupportCheckLog;
} {
  const t = params.replyText.trim();
  const intent = params.latestIntent ?? 'UNKNOWN';
  const userMsg = params.latestUserMessage?.trim() ?? '';

  if (!t) return { rewritten: false, text: params.replyText };

  if (
    userMsg &&
    userMessageSuggestsBreedOrSpeciesServiceQuery(userMsg) &&
    replySuggestsUnsupportedBreedOrPackageRecommendation(t)
  ) {
    return {
      rewritten: true,
      text: NO_KB_FALLBACK_BREED_OR_SPECIES_SERVICE,
      reason: 'no_kb_breed_service_hallucination',
      log: {
        reason: 'no_kb_breed_service_hallucination',
        latestIntent: intent,
        kbChunksLength: 0,
        patternGroup: 'breed_service_recommendation',
      },
    };
  }

  if (replyContainsCustomerFacingPriceClaims(t)) {
    const base = supportCheckPriceBase({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      kbChunksLength: params.kbChunksReturned,
      latestIntent: intent,
    });

    if (params.kbChunksReturned > 0) {
      return {
        rewritten: false,
        text: params.replyText,
        supportCheckLog: { ...base, supportSource: 'kb' },
      };
    }

    const corpus = (params.tenantPricingCorpus ?? '').trim();
    if (priceClaimsGroundedInTenantSources(t, corpus)) {
      return {
        rewritten: false,
        text: params.replyText,
        supportCheckLog: { ...base, supportSource: 'business_notes' },
      };
    }

    return {
      rewritten: true,
      text: NO_KB_FALLBACK_PRICE,
      reason: 'no_kb_price_ungrounded',
      log: {
        reason: 'no_kb_price_ungrounded',
        latestIntent: intent,
        kbChunksLength: 0,
        patternGroup: 'pricing_ungrounded',
      },
      supportCheckLog: { ...base, supportSource: 'unsupported' },
    };
  }

  if (params.kbChunksReturned > 0) {
    return { rewritten: false, text: params.replyText };
  }

  const riskySurface =
    BUSINESS_ASSERTION.test(t) ||
    STANDALONE_WELCOME_ALL_BREEDS.test(t) ||
    (/^yes[!.,]?\s+/i.test(t.trim()) && CLAIM_BREED_SPECIES.test(t) && /\b(welcome|welcome\s+here)\b/i.test(t));

  const risky =
    riskySurface &&
    ((CLAIM_BREED_SPECIES.test(t) && CLAIM_ACCEPT_OFFER.test(t)) ||
      (CLAIM_PRICING.test(t) && CLAIM_ACCEPT_OFFER.test(t)) ||
      (CLAIM_HOURS.test(t) && (/\bwe\s*(are|'re)\s*open\b/i.test(t) || /\bopen\s+(from|until|at)\b/i.test(t))) ||
      (CLAIM_POLICY.test(t) && CLAIM_ACCEPT_OFFER.test(t)) ||
      CLAIM_MEDICAL.test(t));

  if (!risky) return { rewritten: false, text: params.replyText };

  const fallback = pickIntentAwareNoKbFallback(intent, userMsg, t);
  const patternGroup = resolveRiskyPatternGroup(t);

  return {
    rewritten: true,
    text: fallback,
    reason: 'no_kb_unsupported_business_claim',
    log: {
      reason: 'no_kb_unsupported_business_claim',
      latestIntent: intent,
      kbChunksLength: 0,
      patternGroup,
    },
  };
}

export const COMPLAINT_ESCALATION_REPLY =
  "Thanks for telling us — I'm sorry you're dealing with that.\n\n" +
  'To help the team review this properly, please share:\n' +
  '- A clear photo of the area you are concerned about\n' +
  '- Your appointment date and stylist name (if you recall)\n' +
  '- What looks uneven or wrong to you\n' +
  '- The best way to reach you (messaging or call)\n\n' +
  "I'll pass this to the team for review.";

export function buildGovernorCapabilityAppendix(params: {
  bookingCapability: string;
  handoverCapability: string;
}): string {
  return (
    `\n---\n` +
    `Backend capability constraints (must follow — do not contradict):\n` +
    `- bookingCapability: ${params.bookingCapability}\n` +
    `- handoverCapability: ${params.handoverCapability}\n` +
    `Rules:\n` +
    `- You may collect booking details, but you must NOT state that an appointment is confirmed, booked, reserved, or finalized unless the backend has already recorded a successful calendar booking action for this conversation.\n` +
    `- If bookingCapability is collect_details_only, use pending / team-will-confirm language instead.\n` +
    `- If bookingCapability is live_slot_booking, the assistant may offer live CRM slots and collect a selection, but must still avoid confirmed/booked language until the backend confirms a successful appointment create for this conversation.\n` +
    `- For complaints or service recovery, you may ask for details and rely on tag/handover flows — do not claim a callback was arranged unless those backend actions succeeded.\n`
  );
}
