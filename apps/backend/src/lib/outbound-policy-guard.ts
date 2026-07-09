import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';

const HOURS_ANSWER_SIGNAL =
  /\b(weekday|weekend|weekdays|weekends|9\s*(am|pm)|1[01]\s*(am|pm)|open\s*(from|at)|we'?re\s+open)\b/i;

const MENU_VOCAB = /\b(menu|service|services|product|products|offering|offerings|catalogue|catalog|category|categories|price|pricing)\b/i;

type GuardParams = {
  latestIntent: ConversationIntent;
  /** When user picked a menu letter */
  menuSelectionActive?: boolean;
  draftText: string;
};

/**
 * Last-line defense: menu/selection flows must not ship opening-hours boilerplate.
 *
 * Universal: when a draft for a MENU/SHORT_SELECTION clearly returned hours copy and contains no
 * menu/services vocabulary, block it. The caller will skip outbound rather than sending canned copy.
 */
export function applyOutboundPolicyGuard(params: GuardParams): string {
  const { latestIntent, menuSelectionActive, draftText } = params;
  const t = draftText.trim();
  if (!t) return t;

  const menuishIntent =
    latestIntent === 'MENU' ||
    latestIntent === 'SHORT_SELECTION' ||
    (menuSelectionActive ?? false);

  if (menuishIntent && HOURS_ANSWER_SIGNAL.test(t) && !MENU_VOCAB.test(t)) {
    return '';
  }

  return draftText;
}
