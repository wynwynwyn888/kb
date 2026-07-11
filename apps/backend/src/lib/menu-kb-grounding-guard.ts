import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';
import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import { tokenizeMeaningful } from './kb-relevance';

function kbCorpusLower(chunks: RetrievalChunk[]): string {
  return chunks
    .map(c => `${c.title ?? ''} ${c.content ?? ''}`)
    .join('\n')
    .toLowerCase();
}

/** Meaningful tokens (len>=4) from draft excluding template boilerplate lines. */
function draftTokensForGroundingCheck(draft: string): string[] {
  const lines = draft.split(/\n/).map(l => l.trim());
  const body = lines
    .filter(
      l =>
        l.length > 0 &&
        !/^sure[—\-–,]/i.test(l) &&
        !/^i don't have the full/i.test(l) &&
        !/^would you like the team/i.test(l) &&
        !/^what are you in the mood/i.test(l),
    )
    .join(' ');
  return tokenizeMeaningful(body).filter(t => t.length >= 4);
}

/**
 * True when draft's substantive tokens are mostly present in KB corpus (substring match).
 */
export function menuDraftGroundedInKb(draft: string, chunks: RetrievalChunk[]): boolean {
  if (chunks.length === 0) return false;
  const corpus = kbCorpusLower(chunks);
  const tokens = draftTokensForGroundingCheck(draft);
  if (tokens.length === 0) return true;
  let hit = 0;
  for (const tok of tokens) {
    if (corpus.includes(tok)) hit++;
  }
  return hit / tokens.length >= 0.55;
}

export function menuDraftLooksUngrounded(draft: string, chunks: RetrievalChunk[]): boolean {
  const t = draft.trim();
  if (!t) return false;
  /** Policy-authored no-KB menu reply — never rewrite. */
  if (/would you like the team to send you the menu\?/i.test(t)) return false;
  if (chunks.length > 0 && !menuDraftGroundedInKb(draft, chunks)) return true;
  if (chunks.length === 0 && draftTokensForGroundingCheck(draft).length >= 4) return true;
  return false;
}

export type MenuKbGroundingParams = {
  latestIntent: ConversationIntent;
  menuSelectionActive: boolean;
  draftText: string;
  kbChunks: RetrievalChunk[];
  /** Tenant-provided category label from policy selection. */
  categoryLabel?: string | null;
};

function isCanonicalMenuClarification(d: string): boolean {
  return d.trim().length === 0;
}

/**
 * Post-generation: replace invented menu copy when MENU flow cannot be supported by KB.
 *
 * Universal: when the draft is ungrounded, block it. The caller will skip outbound rather than
 * sending canned copy.
 */
export function applyMenuKbGroundingGuard(params: MenuKbGroundingParams): string {
  const { latestIntent, menuSelectionActive, draftText, kbChunks } = params;
  const menuish =
    latestIntent === 'MENU' || latestIntent === 'SHORT_SELECTION' || menuSelectionActive;
  if (!menuish) return draftText;
  if (isCanonicalMenuClarification(draftText)) return draftText;

  if (!menuDraftLooksUngrounded(draftText, kbChunks)) return draftText;

  return '';
}
