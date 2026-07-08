import {
  classifyConversationIntent,
  type ConversationIntent,
} from '../modules/conversation-policy/conversation-intent';

export type KbRetrievalPlan = {
  query: string;
  intent: ConversationIntent;
  source: 'primary' | 'focused';
};

const RE_HOURS =
  /\b(support\s+hours?|business\s+hours?|opening\s+hours?|operating\s+hours?|open|opening|close|closing|closed|hours?|what\s*time|when\s*(do|are)|schedule|bot\s+is\s+down|bot\s+down|down)\b/i;
const RE_LOCATION =
  /\b(where\s*(are|is|do)|office|address|location|located|directions|map|find\s*you|parking)\b/i;
const RE_PRICE = /\b(price|pricing|cost|how\s*much|expensive|cheap|fee|charge|package\s+price|plan)\b/i;
const RE_BOOKING = /\b(book|booking|reserve|reservation|appointment|schedule\s*(a|an)?\s*(call|visit|appointment))\b/i;
const RE_MENU =
  /\b(menu|menus|services?|products?|offerings?|packages?|package\s+list|what\s+do\s+you\s+offer)\b/i;

export function collapseDuplicateRetrievalText(text: string): string {
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return text.trim();

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
  }
  return unique.join('\n\n').trim();
}

export function buildKbRetrievalPlans(
  rawQuery: string,
  latestIntent: ConversationIntent,
): KbRetrievalPlan[] {
  const primaryQuery = collapseDuplicateRetrievalText(rawQuery);
  if (!primaryQuery) return [];

  const plans: KbRetrievalPlan[] = [];
  const keys = new Set<string>();
  const addPlan = (query: string, intent: ConversationIntent, source: KbRetrievalPlan['source']) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;
    const key = `${intent}:${normalizedQuery.toLowerCase().replace(/\s+/g, ' ')}`;
    if (keys.has(key)) return;
    keys.add(key);
    plans.push({ query: normalizedQuery, intent, source });
  };

  const primaryIntent =
    latestIntent !== 'UNKNOWN' ? latestIntent : classifyConversationIntent(primaryQuery);
  addPlan(primaryQuery, primaryIntent, 'primary');

  const surface = primaryQuery.toLowerCase();
  const requestedTopics = {
    hours: RE_HOURS.test(surface),
    location: RE_LOCATION.test(surface),
    price: RE_PRICE.test(surface),
    booking: RE_BOOKING.test(surface),
    menu: RE_MENU.test(surface),
  };
  const topicCount = Object.values(requestedTopics).filter(Boolean).length;
  if (topicCount < 2) return plans;

  if (requestedTopics.hours) {
    addPlan('what are your opening hours?', 'BUSINESS_HOURS', 'focused');
  }
  if (requestedTopics.location) {
    addPlan('where are you located?', 'LOCATION', 'focused');
  }
  if (requestedTopics.price) {
    addPlan('what are your prices?', 'PRICE', 'focused');
  }
  if (requestedTopics.booking) {
    addPlan('how can I book an appointment?', 'BOOKING', 'focused');
  }
  if (requestedTopics.menu) {
    addPlan('what services or packages do you offer?', 'MENU', 'focused');
  }

  return plans.slice(0, 4);
}
