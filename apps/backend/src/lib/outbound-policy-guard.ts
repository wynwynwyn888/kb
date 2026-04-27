import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';

const HOURS_ANSWER_SIGNAL =
  /\b(weekday|weekend|weekdays|weekends|9\s*(am|pm)|1[01]\s*(am|pm)|open\s*(from|at)|we'?re\s+open)\b/i;

type GuardParams = {
  latestIntent: ConversationIntent;
  /** When user picked a menu letter */
  menuSelectionActive?: boolean;
  draftText: string;
};

/**
 * Last-line defense: menu/selection flows must not ship opening-hours boilerplate.
 */
export function applyOutboundPolicyGuard(params: GuardParams): string {
  const { latestIntent, menuSelectionActive, draftText } = params;
  const t = draftText.trim();
  if (!t) return t;

  const menuishIntent =
    latestIntent === 'MENU' ||
    latestIntent === 'SHORT_SELECTION' ||
    (menuSelectionActive ?? false);

  if (menuishIntent && HOURS_ANSWER_SIGNAL.test(t) && !/\b(menu|starter|main|dessert|vegan|dish|food|drink)\b/i.test(t)) {
    return (
      'I can help with the menu.\n\n' +
      'Our menu covers:\n' +
      'A) Starters\n' +
      'B) Mains\n' +
      'C) Desserts\n' +
      'D) Vegan options\n\n' +
      'What are you in the mood for?'
    );
  }

  return draftText;
}
