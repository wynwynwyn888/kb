import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import { MENU_SHORT_OVERVIEW } from '../modules/conversation-policy/policy-menu-copy';
import { INTERNAL_GUIDANCE_LINE_PATTERNS, stripInternalGuidanceFromText } from './kb-internal-guidance';

const RAW_MENU_DUMP = /\bRESTAURANT MENU\b/i;

/**
 * Last-line defense: block internal KB / raw menu document dumps from reaching customers.
 */
export function sanitizeOutboundInternalKbLeak(
  text: string,
  latestIntent: ConversationIntent,
): string {
  const menuish = latestIntent === 'MENU' || latestIntent === 'SHORT_SELECTION';
  const hadInternal = INTERNAL_GUIDANCE_LINE_PATTERNS.some(re => re.test(text));
  let t = stripInternalGuidanceFromText(text);

  if (hadInternal) {
    if (menuish && t.length >= 24 && !INTERNAL_GUIDANCE_LINE_PATTERNS.some(re => re.test(t))) {
      return t;
    }
    if (menuish) {
      return `${MENU_SHORT_OVERVIEW}\n\nWhich section would you like — starters, mains, desserts, or vegan options?`;
    }
    return t.length >= 12 ? t : 'How can I help you today?';
  }

  if (menuish && RAW_MENU_DUMP.test(t) && t.length > 2200) {
    return (
      `${t.slice(0, 1900).trim()}…\n\n` +
      'Would you like more detail on starters, mains, desserts, or vegan options?'
    );
  }

  return t;
}
