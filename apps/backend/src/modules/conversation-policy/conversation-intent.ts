/**
 * Deterministic lexical intent for the latest inbound customer message.
 * Extensible: add ML later behind the same enum.
 */

export type ConversationIntent =
  | 'GREETING'
  | 'BUSINESS_HOURS'
  | 'MENU'
  | 'BOOKING'
  | 'PRICE'
  | 'LOCATION'
  | 'COMPLAINT'
  | 'HUMAN_HANDOVER'
  | 'SHORT_SELECTION'
  | 'CONFIRMATION'
  | 'HESITATION'
  | 'EXPLICIT_OPT_OUT'
  | 'UNKNOWN';

// HUMAN_HANDOVER should require both:
// - a "person/staff/team" concept AND
// - a "contact/connect/speak/help" request pattern
// to avoid false positives like "facial for human" or "safe for humans".
const RE_HANDOVER_NOUN =
  /\b(human|humans|person|people|real\s*person|agent|staff|team|representative|rep|manager|owner|someone)\b/i;
const RE_HANDOVER_VERB =
  /\b(speak|talk|call|phone|contact|connect|transfer|escalat(e|ion)|handover|get|reach|help|assist|request|need|want)\b/i;
const RE_HANDOVER_REQUEST =
  /\b(can\s+i|could\s+you|please|i\s+want|i\s+need|let\s+me|connect\s+me|put\s+me)\b/i;
const RE_HANDOVER_DIRECT_REQUEST =
  /\b(human\s+agent\s+please|manager\s+please|real\s*person\s+please|someone\s+please)\b/i;
/** Deterministic phrases — avoids requiring "please" / "can I" (e.g. "talk to human"). */
const RE_HANDOVER_PHRASE_PRIORITIZED =
  /\b(?:(?:talk|speak)\s+to\s+(?:a\s+)?(?:human|staff|person|someone)|can\s+i\s+(?:talk|speak|request)\s+(?:to\s+)?(?:a\s+)?(?:human|staff|person|someone|agent|manager)|could\s+i\s+(?:talk|speak|request)\s+(?:to\s+)?(?:a\s+)?(?:human|staff|person|someone|agent|manager)|(?:request|need|want)\s+(?:a\s+)?(?:human|staff|person|someone|agent|manager)|connect\s+me\s+to\s+(?:the\s+)?(?:team|staff|human|someone)|get\s+someone\s+to\s+contact\s+me)\b/i;
const RE_HUMAN_ONLY_SERVICE_CONTEXT =
  /\b(for\s+human|for\s+humans|treat\s+humans|safe\s+for\s+humans)\b/i;
const RE_COMPLAINT = /\b(complaint|complain|terrible|awful|horrible|angry|furious|disgusting|worst|sue|refund\s*now)\b/i;
const RE_GREETING = /^(hi|hello|hey|hiya|yo|good\s*(morning|afternoon|evening)|howdy)\b[!?.\s]*$/i;
const RE_GREETING_LOOSE = /^(hi|hello|hey)\b/i;
const RE_HOURS =
  /\b(open|opening|close|closing|closed|hour|hours|what\s*time|when\s*(do|are)|weekday|weekend|schedule|today|tomorrow)\b/i;
const RE_MENU =
  /\b(menu|menus|service|services|product|products|offering|offerings|catalog|catalogue|options|categories|packages?|package\s+list)\b/i;
const RE_BOOKING =
  /\b(book|booking|reserve|reservation|appointment|schedule\s*(?:a|an)?\s*(?:appointment|visit))\b/i;
const RE_PRICE = /\b(price|pricing|cost|how\s*much|expensive|cheap|fee|charge)\b/i;
const RE_LOCATION = /\b(where\s*(are|is|do)|address|location|directions|map|find\s*you|parking)\b/i;
const RE_CONFIRM = /^(yes|yeah|yep|yup|sure|ok|okay|please\s*do|go\s*ahead)\b[!?.\s]*$/i;
// Opt-out is deliberately narrow. A negative answer to a sales question is not consent to stop
// all contact; only an explicit stop-contact request receives this safety-critical intent.
const RE_EXPLICIT_OPT_OUT =
  /^(?:please\s+)?(?:stop(?:\s+(?:messaging|contacting|texting|following\s+up)(?:\s+me)?)?|unsubscribe|do\s+not\s+(?:contact|message|text|follow\s+up\s+with)\s+me(?:\s+again)?|don['’]?t\s+(?:contact|message|text|follow\s+up\s+with)\s+me(?:\s+again)?|remove\s+me\s+from\s+(?:your|the)\s+(?:list|messages)|no\s+further\s+contact)[.!?\s]*$/i;

// Ordinary sales hesitation is contextual guidance for generation, not an opt-out command.
const RE_HESITATION =
  /^(?:h+m+|u+h+|u+m+|erm+|maybe(?:\s+later)?|not\s+now|no(?:\s+thanks)?|nope|nah|not\s+interested|let\s+me\s+(?:consider|think|check)|i\s+(?:need|want)\s+(?:some\s+)?time(?:\s+to\s+(?:consider|think))?|i['’]?ll\s+(?:consider|think)(?:\s+about\s+it)?|i\s+will\s+(?:consider|think)(?:\s+about\s+it)?)[.!?…\s]*$/i;

/** Single letter A–H or 1–8 (aligned with option memory / resolveShortSelection), optional punctuation */
const RE_SHORT_LETTER = /^[a-hA-H][\s!.?]*$/;
const RE_SHORT_DIGIT = /^[1-8][\s!.?]*$/;
const RE_OPTION_WORD = /\b(option\s*[a-hA-H1-8]|choice\s*[a-hA-H1-8])\b/i;
const RE_FIRST_LAST = /^(?:the\s+)?(?:first|last)(?:\s+(?:one|option|choice))?[\s!.?]*$/i;

export function classifyConversationIntent(message: string): ConversationIntent {
  const t = message.trim();
  if (!t) return 'UNKNOWN';

  if (!RE_HUMAN_ONLY_SERVICE_CONTEXT.test(t)) {
    if (RE_HANDOVER_DIRECT_REQUEST.test(t)) return 'HUMAN_HANDOVER';
    if (RE_HANDOVER_PHRASE_PRIORITIZED.test(t)) return 'HUMAN_HANDOVER';
    if (
      RE_HANDOVER_NOUN.test(t) &&
      (RE_HANDOVER_VERB.test(t) || /\bagent\b/i.test(t)) &&
      (RE_HANDOVER_REQUEST.test(t) || /\?$/.test(t) || /\bplease\b/i.test(t))
    ) {
      return 'HUMAN_HANDOVER';
    }
  }
  if (RE_COMPLAINT.test(t)) return 'COMPLAINT';
  if (RE_EXPLICIT_OPT_OUT.test(t)) return 'EXPLICIT_OPT_OUT';

  if (RE_SHORT_LETTER.test(t) || RE_SHORT_DIGIT.test(t) || RE_OPTION_WORD.test(t) || RE_FIRST_LAST.test(t)) {
    return 'SHORT_SELECTION';
  }

  if (RE_GREETING.test(t) || (t.length <= 12 && RE_GREETING_LOOSE.test(t))) return 'GREETING';

  if (RE_BOOKING.test(t)) return 'BOOKING';
  if (RE_PRICE.test(t)) return 'PRICE';
  if (RE_LOCATION.test(t)) return 'LOCATION';

  if (RE_HOURS.test(t) && !RE_MENU.test(t)) return 'BUSINESS_HOURS';
  if (RE_MENU.test(t) && !RE_HOURS.test(t)) return 'MENU';
  if (RE_MENU.test(t) && RE_HOURS.test(t)) {
    if (t.length < 40 && RE_MENU.test(t)) return 'MENU';
    return 'UNKNOWN';
  }

  if (RE_CONFIRM.test(t)) return 'CONFIRMATION';
  if (RE_HESITATION.test(t)) return 'HESITATION';

  return 'UNKNOWN';
}
