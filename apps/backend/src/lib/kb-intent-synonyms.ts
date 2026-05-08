/**
 * Universal query→intent synonym map for KB retrieval.
 *
 * Goal: when a user types "hour" / "where" / "menu" / "refund" / "balayage", we expand the query
 * into a richer token set + a virtual intent (e.g. INTENT_HOURS) that matches typical KB section
 * titles regardless of business vertical. No business-specific topics; only generic intents.
 */

import { type ConversationIntent, classifyConversationIntent } from '../modules/conversation-policy/conversation-intent';
import { KB_STOPWORDS } from './kb-relevance';

export type KbIntentSynonymGroup =
  | 'INTENT_HOURS'
  | 'INTENT_ADDRESS'
  | 'INTENT_MENU'
  | 'INTENT_PRICE'
  | 'INTENT_BOOKING'
  | 'INTENT_COMPLAINT';

export interface KbIntentSynonymHit {
  intent: KbIntentSynonymGroup;
  expandedTokens: string[];
  /** Section-title fragments that strongly indicate this intent in headings (any case). */
  sectionTitleHints: string[];
  /** For INTENT_MENU only: headings that indicate a top-level menu / catalog (not category sections). */
  menuListingPrimaryHints?: string[];
  /** For INTENT_MENU only: weaker menu-adjacent heading tokens (e.g. "services" inside "Colour Services"). */
  menuListingSecondaryHints?: string[];
}

const INTENT_GROUPS: ReadonlyArray<{
  intent: KbIntentSynonymGroup;
  /** lowercase tokens that map to this intent */
  triggers: string[];
  /** tokens to add when this intent is detected (also lowercase) */
  expand: string[];
  /** section-heading hints (lowercase substrings) */
  titleHints: string[];
  menuListingPrimaryHints?: string[];
  menuListingSecondaryHints?: string[];
}> = [
  {
    intent: 'INTENT_HOURS',
    triggers: [
      'hour',
      'hours',
      'open',
      'opening',
      'close',
      'closing',
      'closed',
      'time',
      'times',
      'when',
      'schedule',
      'today',
      'tomorrow',
      'weekday',
      'weekdays',
      'weekend',
      'weekends',
      'business',
      'shifts',
    ],
    expand: ['hour', 'hours', 'opening', 'open', 'close', 'closing', 'schedule'],
    titleHints: ['hour', 'hours', 'opening', 'schedule', 'business hour'],
  },
  {
    intent: 'INTENT_ADDRESS',
    triggers: [
      'address',
      'location',
      'located',
      'where',
      'directions',
      'direction',
      'map',
      'find',
      'parking',
      'reach',
      'situated',
    ],
    expand: ['address', 'location', 'directions', 'parking'],
    titleHints: ['address', 'location', 'directions', 'find us'],
  },
  {
    intent: 'INTENT_MENU',
    triggers: [
      'menu',
      'menus',
      'service',
      'services',
      'offering',
      'offerings',
      'catalog',
      'catalogue',
      'pricelist',
      'price',
      'prices',
      'pricing',
      'list',
      'package',
      'packages',
      'product',
      'products',
      'offer',
      'offers',
      'grooming',
      'groom',
      'daycare',
      'spa',
      'boarding',
      'kennel',
      'deshed',
      'trim',
    ],
    expand: ['menu', 'service', 'services', 'offering', 'pricing', 'catalog', 'product', 'products'],
    titleHints: [
      'menu',
      'service menu',
      'services',
      'service categories',
      'price list',
      'pricing',
      'catalog',
      'catalogue',
      'offerings',
      'products',
      'packages',
      'grooming',
      'daycare',
      'spa',
      'boarding',
      'pet',
    ],
    menuListingPrimaryHints: [
      'service menu',
      'menu',
      'price list',
      'pricelist',
      'catalogue',
      'catalog',
      'offerings',
      'products',
      'grooming',
      'daycare',
      'spa',
    ],
    menuListingSecondaryHints: ['services', 'service', 'pricing', 'packages'],
  },
  {
    intent: 'INTENT_PRICE',
    triggers: ['price', 'prices', 'pricing', 'cost', 'costs', 'fee', 'fees', 'charge', 'charges', 'rate', 'rates', 'how much', 'expensive', 'cheap', 'budget'],
    expand: ['price', 'pricing', 'cost', 'fee', 'rate', 'rm', 'sgd', 'usd'],
    titleHints: ['price', 'pricing', 'rates', 'fees', 'cost'],
  },
  {
    intent: 'INTENT_BOOKING',
    triggers: ['book', 'booking', 'appointment', 'appointments', 'reservation', 'reserve', 'schedule', 'reschedule', 'slot', 'slots'],
    expand: ['book', 'booking', 'appointment', 'reservation', 'schedule', 'slot'],
    titleHints: ['booking', 'appointment', 'reservation', 'schedule'],
  },
  {
    intent: 'INTENT_COMPLAINT',
    triggers: [
      'complaint',
      'complain',
      'complaints',
      'refund',
      'refunds',
      'return',
      'returns',
      'cancel',
      'cancellation',
      'cancellations',
      'unhappy',
      'angry',
      'issue',
      'problem',
      'sorry',
      'mistake',
    ],
    expand: ['complaint', 'refund', 'cancellation', 'policy', 'return'],
    titleHints: ['complaint', 'refund', 'cancellation', 'return policy', 'policy'],
  },
];

export interface ExpandQueryResult {
  /** Lowercase token set used for content/title scoring (deduped, length>=2). */
  tokens: string[];
  /** Distinct intents detected in the query/intent hint, used for heading boosts. */
  intents: KbIntentSynonymGroup[];
  /** Heading substrings (lowercase) that should boost section title matches. */
  sectionTitleHints: string[];
  /** Primary menu/catalog heading hints (top-level listing sections). */
  menuListingPrimaryHints: string[];
  /** Secondary menu-adjacent hints (e.g. "services" inside category titles). */
  menuListingSecondaryHints: string[];
  /**
   * True when the user is browsing offerings (menu / catalog / "what do you offer"),
   * not asking for a named item like "keratin".
   */
  broadMenuListingQuery: boolean;
  /** Post-care / maintenance / "after X" style queries. */
  aftercareIntent: boolean;
}

/** Tokens typical of "show me your menu" style questions — not named services or locations. */
const MENU_LISTING_TOKEN_ARRAY: readonly string[] = [
  'menu',
  'menus',
  'service',
  'services',
  'offering',
  'offerings',
  'catalog',
  'catalogue',
  'pricelist',
  'price',
  'prices',
  'pricing',
  'list',
  'listing',
  'package',
  'packages',
  'product',
  'products',
  'show',
  'please',
  'help',
  'what',
  'which',
  'kind',
  'kinds',
  'type',
  'types',
  'do',
  'you',
  'we',
  'our',
  'the',
  'a',
  'an',
  'of',
  'for',
  'me',
  'my',
  'i',
  'want',
  'need',
  'looking',
  'available',
  'tell',
  'give',
  'some',
  'any',
  'all',
  'see',
  'know',
  'about',
  'offer',
  'offers',
  'option',
  'options',
  'everything',
  'stuff',
  'info',
  'information',
  'could',
  'would',
  'should',
  'did',
  'does',
  'have',
  'has',
  'there',
  'they',
  'them',
  'is',
  'are',
  'was',
  'were',
  'be',
  'how',
  'when',
  'why',
  'where',
  'who',
  'can',
  'may',
  'might',
  'really',
  'just',
  'also',
  'too',
  'very',
  'much',
  'more',
  'most',
  'other',
  'another',
  'such',
  'into',
  'than',
  'then',
  'with',
  'without',
  'from',
  'get',
  'got',
  'go',
  'come',
  'came',
  'take',
  'make',
  'made',
  'use',
  'used',
  'using',
  'find',
  'found',
  'check',
  'checking',
  'browse',
  'exploring',
  'explore',
  'your',
  'their',
  'this',
  'that',
  'these',
  'those',
  'here',
  'something',
  'anything',
  'nothing',
  'every',
  'both',
  'each',
  'either',
  'neither',
  'done',
  'doing',
  'being',
  'been',
  'well',
  'even',
  'still',
  'again',
  'back',
  'only',
  'same',
  'own',
  'someone',
  'anyone',
  'everyone',
  'now',
  'today',
  'tomorrow',
  'sale',
  'sales',
  'shop',
  'store',
  'buy',
  'purchase',
  'booking',
  'book',
  'online',
  'super',
  'superb',
  'great',
  'good',
  'best',
  'new',
  'old',
  'first',
  'last',
  'next',
  'previous',
  'thanks',
  'thank',
  'hello',
  'hi',
  'hey',
  'pls',
  'plz',
];

const MENU_LISTING_TOKEN_SET = new Set<string>(MENU_LISTING_TOKEN_ARRAY);

export function detectAftercareIntentForSearch(query: string, intentHint?: string): boolean {
  const lc = `${query} ${intentHint ?? ''}`.toLowerCase();
  if (!lc.trim()) return false;
  if (/\baftercare\b|after-care|after care\b/.test(lc)) return true;
  if (/\bwhat\s+to\s+do\s+after\b/.test(lc)) return true;
  if (/\b(post|following)\s+(-| )?(treatment|care|service)\b/i.test(lc)) return true;
  if (/\b(maintain|maintenance|wash|washing)\b/.test(lc) && /\b(after|following)\b/.test(lc)) return true;
  if (/\bafter\s+[a-zÀ-ÿ]{3,}\b/i.test(lc)) return true;
  return false;
}

function computeBroadMenuListingQuery(query: string, intents: KbIntentSynonymGroup[]): boolean {
  if (!intents.includes('INTENT_MENU')) return false;
  const toks = lowerTokens(query).filter(t => t.length >= 3 && !KB_STOPWORDS.has(t));
  if (toks.length === 0) return true;
  return toks.every(t => MENU_LISTING_TOKEN_SET.has(t));
}

/** True when the query names a specific item (e.g. keratin) rather than only menu-browsing words. */
export function isFocusedEntityServiceQuery(query: string): boolean {
  const toks = lowerTokens(query).filter(t => t.length >= 4 && !KB_STOPWORDS.has(t));
  if (toks.length === 0) return false;
  return toks.some(t => !MENU_LISTING_TOKEN_SET.has(t));
}

function lowerTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function detectIntentsFromText(text: string): KbIntentSynonymHit[] {
  const lc = text.toLowerCase();
  const tokens = new Set(lowerTokens(text));
  const hits: KbIntentSynonymHit[] = [];
  const seen = new Set<KbIntentSynonymGroup>();
  for (const g of INTENT_GROUPS) {
    let trigger = false;
    for (const t of g.triggers) {
      if (t.includes(' ')) {
        if (lc.includes(t)) {
          trigger = true;
          break;
        }
      } else if (tokens.has(t)) {
        trigger = true;
        break;
      }
    }
    if (!trigger) continue;
    if (seen.has(g.intent)) continue;
    seen.add(g.intent);
    hits.push({
      intent: g.intent,
      expandedTokens: g.expand.slice(),
      sectionTitleHints: g.titleHints.slice(),
      ...(g.menuListingPrimaryHints
        ? {
            menuListingPrimaryHints: g.menuListingPrimaryHints.slice(),
            menuListingSecondaryHints: (g.menuListingSecondaryHints ?? []).slice(),
          }
        : {}),
    });
  }
  return hits;
}

/**
 * Expand the raw query (and optional intent hint) into a token set and a list of intent groups
 * usable for heading-aware scoring.
 */
export function expandKbQueryWithIntent(query: string, intentHint?: string): ExpandQueryResult {
  const fromQuery = detectIntentsFromText(query);
  const fromHint = intentHint ? detectIntentsFromText(intentHint.replace(/_/g, ' ')) : [];

  // Domain enum hints (BUSINESS_HOURS, LOCATION, MENU, PRICE, BOOKING, COMPLAINT) → groups
  if (intentHint) {
    const hintLc = intentHint.toLowerCase();
    const map: Array<[RegExp, KbIntentSynonymGroup]> = [
      [/business[_\s-]*hour|^hours?$/i, 'INTENT_HOURS'],
      [/location|address/i, 'INTENT_ADDRESS'],
      [/menu/i, 'INTENT_MENU'],
      [/price/i, 'INTENT_PRICE'],
      [/booking/i, 'INTENT_BOOKING'],
      [/complaint|refund/i, 'INTENT_COMPLAINT'],
    ];
    for (const [re, intent] of map) {
      if (!re.test(hintLc)) continue;
      const g = INTENT_GROUPS.find(x => x.intent === intent);
      if (g && !fromHint.some(h => h.intent === intent)) {
        fromHint.push({
          intent,
          expandedTokens: g.expand.slice(),
          sectionTitleHints: g.titleHints.slice(),
          ...(g.menuListingPrimaryHints
            ? {
                menuListingPrimaryHints: g.menuListingPrimaryHints.slice(),
                menuListingSecondaryHints: (g.menuListingSecondaryHints ?? []).slice(),
              }
            : {}),
        });
      }
    }
  }

  const intents = [...new Set([...fromQuery.map(h => h.intent), ...fromHint.map(h => h.intent)])];
  const baseTokens = new Set<string>(lowerTokens(query));
  for (const h of [...fromQuery, ...fromHint]) {
    for (const t of h.expandedTokens) baseTokens.add(t);
  }

  const sectionTitleHints = new Set<string>();
  for (const h of [...fromQuery, ...fromHint]) {
    for (const s of h.sectionTitleHints) sectionTitleHints.add(s);
  }

  const menuListingPrimaryHints = new Set<string>();
  const menuListingSecondaryHints = new Set<string>();
  for (const h of [...fromQuery, ...fromHint]) {
    for (const s of h.menuListingPrimaryHints ?? []) menuListingPrimaryHints.add(s);
    for (const s of h.menuListingSecondaryHints ?? []) menuListingSecondaryHints.add(s);
  }

  const broadMenuListingQuery = computeBroadMenuListingQuery(query, intents);
  const aftercareIntent = detectAftercareIntentForSearch(query, intentHint);

  return {
    tokens: [...baseTokens].filter(t => t.length >= 2),
    intents,
    sectionTitleHints: [...sectionTitleHints],
    menuListingPrimaryHints: [...menuListingPrimaryHints],
    menuListingSecondaryHints: [...menuListingSecondaryHints],
    broadMenuListingQuery,
    aftercareIntent,
  };
}

/**
 * When orchestration still has UNKNOWN intent, infer a retrieval hint from the query so keyword
 * scoring + heading boosts align with service/menu/hours/price questions (pet vertical included).
 */
export function inferKbRetrievalIntentHint(message: string): ConversationIntent | undefined {
  const direct = classifyConversationIntent(message);
  if (direct !== 'UNKNOWN') return direct;

  const lc = message.trim().toLowerCase();
  if (!lc) return undefined;

  if (
    /\b(grooming|groom|daycare|spa\b|boarding|kennel|deshed|full\s+groom|dog\s+wash|nail\s+trim|service\s+categories)\b/i.test(
      lc,
    )
  ) {
    return 'MENU';
  }
  if (/\b(how\s+much|price|pricing|cost|fee|charge)\b/i.test(lc)) return 'PRICE';
  if (/\b(open|opening|close|closing|hours?|what\s*time|when\s+do\s+you)\b/i.test(lc)) return 'BUSINESS_HOURS';
  if (/\b(book|booking|slot|slots|availability|appointment|reserve)\b/i.test(lc)) return 'BOOKING';

  return undefined;
}
