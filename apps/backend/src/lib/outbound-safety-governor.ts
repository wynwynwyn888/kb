/**
 * Outbound safety / conversation governor — pure helpers for pre-send checks.
 * Blocks unsafe booking claims, menu noise, and supports complaint/scope detection in orchestration.
 */

import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import { detectMenuIntentInMessage } from './kb-relevance';

export const SAFE_PENDING_BOOKING_REPLY =
  '';

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
  if (!s) return false;
  if (s === 'AI') return true;
  return s.startsWith('CONVERSATION_BOOKING:') || s.startsWith('WHATSAPP_BOOKING:');
}

export type ComplaintServiceIssue = {
  triggered: boolean;
  reason: string;
  /** Tag names to queue for GHL (lowercase, snake_case) */
  tags: string[];
};

const COMPLAINT_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\bcomplaint\b/i, reason: 'complaint_keyword' },
  { re: /\brefund\b/i, reason: 'refund' },
  { re: /\bnot\s+(?:happy|satisfied)\s+with\b/i, reason: 'customer_dissatisfied' },
  { re: /\b(?:bad|poor|terrible|unacceptable)\s+(?:result|experience|service|product)\b/i, reason: 'negative_experience' },
  { re: /\b(?:damaged|defective|broken|wrong)\b.*\b(?:after|received|result|service|product)\b/i, reason: 'reported_problem' },
];

export function detectComplaintServiceIssue(raw: string): ComplaintServiceIssue {
  const t = raw.trim();
  if (!t) {
    return { triggered: false, reason: 'none', tags: [] };
  }
  for (const p of COMPLAINT_PATTERNS) {
    if (p.re.test(t)) {
      const tags = ['needs_human_review', 'complaint_service_issue'];
      return { triggered: true, reason: p.reason, tags };
    }
  }
  return { triggered: false, reason: 'none', tags: [] };
}

const MENU_ASK = /\b(menu|categories|category|options?|what\s+do\s+you\s+offer|list\s+of\s+services|book\s+from\s+the\s+menu)\b/i;

export function userAskedForMenuOrOptions(latestInbound: string, latestIntent: ConversationIntent): boolean {
  if (latestIntent === 'MENU' || latestIntent === 'SHORT_SELECTION') return true;
  const t = latestInbound.trim();
  if (!t) return false;
  if (MENU_ASK.test(t)) return true;
  return false;
}

export const UNREQUESTED_MENU_FALLBACK_REPLY =
  '';

/**
 * No-KB business-claim guard:
 * When KB retrieval is empty/weak, block hallucinated business-specific claims about offerings,
 * prices, opening hours, availability, policies, or regulated advice.
 * Returns a safe uncertainty reply when a risky claim is detected.
 */
export const SAFE_UNSUPPORTED_BUSINESS_CLAIM_REPLY =
  '';

export const NO_KB_FALLBACK_MENU_SERVICE_LIST =
  '';

export const NO_KB_FALLBACK_BROAD_SERVICE =
  '';

export const NO_KB_FALLBACK_SERVICE =
  '';

export const NO_KB_FALLBACK_PRICE =
  '';

export const NO_KB_FALLBACK_HOURS = '';

export const NO_KB_FALLBACK_AVAILABILITY =
  '';

const BUSINESS_ASSERTION = /\b(we|our\s+(?:team|business|company)|yes,?\s+we)\b/i;
const CLAIM_ACCEPT_OFFER =
  /\b(accept|welcome|allow|can\s+take|we\s+do|we\s+offer|we\s+recommend|provide|available|availability)\b/i;
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

const BLOCK_UNSUPPORTED_CLAIM_REPLY = '';

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

export function userAskedBroadServiceBrowseQuery(message: string, intent: ConversationIntent): boolean {
  const raw = message.trim();
  if (!raw) return false;
  if (/\b(what\s+(?:services|products|options)\s+do\s+you|what\s+do\s+you\s+offer|service\s+list|list\s+of\s+(?:services|products))\b/i.test(raw)) {
    return true;
  }
  if (intent === 'MENU' && /\b(what\s+service|your\s+menu)\b/i.test(raw)) return true;
  return false;
}

function resolveRiskyPatternGroup(replyText: string): string {
  if (BUSINESS_ASSERTION.test(replyText) && CLAIM_ACCEPT_OFFER.test(replyText)) return 'unsupported_offering';
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

  const ml = probe.toLowerCase();

  if (userAskedBroadServiceBrowseQuery(probe, intent)) {
    return BLOCK_UNSUPPORTED_CLAIM_REPLY;
  }

  if (intent === 'PRICE' || /\b(how\s+much|price|pricing|cost|fee|charge)\b/i.test(ml)) {
    return BLOCK_UNSUPPORTED_CLAIM_REPLY;
  }

  if (
    intent === 'BUSINESS_HOURS' ||
    (/\b(open|opening|close|closing|hours?)\b/i.test(ml) && !detectMenuIntentInMessage(probe))
  ) {
    return BLOCK_UNSUPPORTED_CLAIM_REPLY;
  }

  if (
    intent === 'BOOKING' ||
    /\b(slot|slots|availability|available\s+(?:slot|appointment|time)|next\s+available)\b/i.test(ml)
  ) {
    return BLOCK_UNSUPPORTED_CLAIM_REPLY;
  }

  if (intent === 'MENU' || detectMenuIntentInMessage(probe)) {
    return BLOCK_UNSUPPORTED_CLAIM_REPLY;
  }

  return BLOCK_UNSUPPORTED_CLAIM_REPLY;
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
      text: BLOCK_UNSUPPORTED_CLAIM_REPLY,
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
    BUSINESS_ASSERTION.test(t);

  const risky =
    riskySurface &&
    (CLAIM_ACCEPT_OFFER.test(t) ||
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
  '';

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
    `- For complaints or service recovery, you may ask for details and rely on tag/handover flows — do not claim a callback was arranged unless those backend actions succeeded.\n` +
    `- The assistant can handle text enquiries and can process supported voice notes by transcription when voice handling is enabled; do not tell customers that voice notes are unsupported.\n` +
    `- You can analyze photos customers send in chat (WhatsApp, Messenger, etc.) when the image is delivered to the platform. If they ask whether you understand or can see images, answer yes and invite them to send a photo — do not say you cannot analyze images unless this turn has no photo and they are not asking about capability.\n`
  );
}
