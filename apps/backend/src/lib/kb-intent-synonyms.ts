/**
 * Universal query→intent synonym map for KB retrieval.
 *
 * Goal: when a user types "hour" / "where" / "menu" / "refund" / "balayage", we expand the query
 * into a richer token set + a virtual intent (e.g. INTENT_HOURS) that matches typical KB section
 * titles regardless of business vertical. No business-specific topics; only generic intents.
 */

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
}

const INTENT_GROUPS: ReadonlyArray<{
  intent: KbIntentSynonymGroup;
  /** lowercase tokens that map to this intent */
  triggers: string[];
  /** tokens to add when this intent is detected (also lowercase) */
  expand: string[];
  /** section-heading hints (lowercase substrings) */
  titleHints: string[];
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
    ],
    expand: ['menu', 'service', 'services', 'offering', 'pricing', 'catalog', 'product', 'products'],
    titleHints: [
      'menu',
      'service menu',
      'services',
      'price list',
      'pricing',
      'catalog',
      'catalogue',
      'offerings',
      'products',
      'packages',
    ],
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

  return {
    tokens: [...baseTokens].filter(t => t.length >= 2),
    intents,
    sectionTitleHints: [...sectionTitleHints],
  };
}
