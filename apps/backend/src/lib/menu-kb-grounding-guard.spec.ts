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

describe('menu-kb-grounding-guard (universal)', () => {
  const restaurantMainsKb = chunk({
    title: 'Mains',
    content: 'Chicken rice and beef noodles are available.',
    metadata: {},
  });

  it('flags seafood/marketing menu prose as ungrounded vs KB', () => {
    const draft =
      'Our seafood mains include ocean-fresh salmon, and our meat mains are hearty, richly flavoured signatures.';
    expect(menuDraftLooksUngrounded(draft, [restaurantMainsKb])).toBe(true);
  });

  it('replaces invented menu copy with selectedCategoryNoKbReply when categoryLabel given', () => {
    const draft =
      'Sure — mains.\n\nOur seafood mains and meat mains are elegantly seasoned with ocean-fresh ingredients.';
    const out = applyMenuKbGroundingGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: draft,
      kbChunks: [restaurantMainsKb],
      categoryLabel: 'Mains',
    });
    // Generic "no full details" copy referencing the chosen category — no invented seafood/ocean prose.
    expect(out.toLowerCase()).not.toContain('seafood');
    expect(out.toLowerCase()).not.toContain('ocean');
    expect(out.toLowerCase()).toContain('mains');
  });

  it('falls back to MENU_PROMPT_NO_KB when ungrounded and no categoryLabel', () => {
    const draft =
      'Our seafood mains include ocean-fresh salmon and richly flavoured signatures.';
    const out = applyMenuKbGroundingGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: draft,
      kbChunks: [],
    });
    expect(out).toMatch(/Happy to help|connect you/i);
    expect(out.toLowerCase()).not.toContain('seafood');
  });

  it('does not rewrite a draft already grounded in KB', () => {
    const grounded = 'We have chicken rice and beef noodles.';
    const out = applyMenuKbGroundingGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: grounded,
      kbChunks: [restaurantMainsKb],
      categoryLabel: 'Mains',
    });
    expect(out).toBe(grounded);
  });
});
