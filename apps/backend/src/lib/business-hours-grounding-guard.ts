import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import { polishKbSnippetForCustomer } from './kb-faq-customer-text';

const SERVICE_TIME_WORD = /\b(lunch|dinner|brunch|supper|tea\s*service|kitchen\s*hours|last\s*orders?)\b/i;

/**
 * Avoid lunch/dinner seating copy when the user only asked general opening hours
 * and KB does not mention that meal period in the merged corpus.
 */
export function applyBusinessHoursGroundingGuard(params: {
  latestIntent: ConversationIntent;
  userMessage: string;
  kbChunks: RetrievalChunk[];
  draftText: string;
}): string {
  const { latestIntent, userMessage, kbChunks, draftText } = params;
  if (latestIntent !== 'BUSINESS_HOURS') return draftText;
  const t = draftText.trim();
  if (!t || kbChunks.length === 0) return draftText;

  const u = userMessage.toLowerCase();
  const userAskedMeal = SERVICE_TIME_WORD.test(u);

  if (!SERVICE_TIME_WORD.test(t)) return draftText;
  if (userAskedMeal) return draftText;

  const corpus = kbChunks.map(c => `${c.title} ${c.content}`).join(' ').toLowerCase();
  const draftLower = t.toLowerCase();
  const mealInDraft = draftLower.match(SERVICE_TIME_WORD);
  if (mealInDraft?.[0] && corpus.includes(mealInDraft[0])) {
    return draftText;
  }

  const top = kbChunks[0]!;
  const snippet = (top.content ?? '').slice(0, 520).trim();
  if (!snippet) return draftText;
  return polishKbSnippetForCustomer(`${snippet}${snippet.length === top.content.length ? '' : '...'}`);
}
