import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import { applyMenuKbGroundingGuard, menuDraftLooksUngrounded } from './menu-kb-grounding-guard';

function chunk(partial: Partial<RetrievalChunk> & Pick<RetrievalChunk, 'title' | 'content'>): RetrievalChunk {
  return {
    chunkId: 'c1',
    documentId: 'd1',
    title: partial.title,
    content: partial.content,
    source: partial.source ?? 'faq',
    relevanceScore: 0.9,
    metadata: partial.metadata ?? {},
  };
}

describe('menu-kb-grounding-guard', () => {
  const mainsKb = chunk({
    title: 'Mains',
    content: 'Chicken rice and beef noodles are available.',
    metadata: {},
  });

  it('4: flags seafood/marketing menu prose as ungrounded vs KB', () => {
    const draft =
      'Our seafood mains include ocean-fresh salmon, and our meat mains are hearty, richly flavoured signatures.';
    expect(menuDraftLooksUngrounded(draft, [mainsKb])).toBe(true);
  });

  it('replace invented menu copy with safe no-KB template', () => {
    const draft =
      'Sure — mains.\n\nOur seafood mains and meat mains are elegantly seasoned with ocean-fresh ingredients.';
    const out = applyMenuKbGroundingGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: draft,
      kbChunks: [mainsKb],
      categoryLabel: 'Mains',
    });
    expect(out).toMatch(/send you the menu/i);
    expect(out.toLowerCase()).not.toContain('seafood');
    expect(out.toLowerCase()).not.toContain('ocean');
  });

  it('does not rewrite policy no-KB template', () => {
    const safe =
      "Sure — mains.\n\nI don't have the full mains details here yet. Would you like the team to send you the menu?";
    const out = applyMenuKbGroundingGuard({
      latestIntent: 'SHORT_SELECTION',
      menuSelectionActive: true,
      draftText: safe,
      kbChunks: [],
      categoryLabel: 'Mains',
    });
    expect(out).toBe(safe);
  });
});