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

  it('blocks invented menu copy when categoryLabel is present but draft is ungrounded', () => {
    const draft =
      'Sure — mains.\n\nOur seafood mains and meat mains are elegantly seasoned with ocean-fresh ingredients.';
    const out = applyMenuKbGroundingGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: draft,
      kbChunks: [restaurantMainsKb],
      categoryLabel: 'Mains',
    });
    expect(out).toBe('');
  });

  it('blocks ungrounded menu copy when no categoryLabel is present', () => {
    const draft =
      'Our seafood mains include ocean-fresh salmon and richly flavoured signatures.';
    const out = applyMenuKbGroundingGuard({
      latestIntent: 'MENU',
      menuSelectionActive: false,
      draftText: draft,
      kbChunks: [],
    });
    expect(out).toBe('');
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

  it('allows validated tenant-configured multi-selections without a KB document', () => {
    const configured =
      'You selected lead follow-up, manual chasing, and uncertain sales tracking. These often overlap, so let us start with your current follow-up process.';
    const out = applyMenuKbGroundingGuard({
      latestIntent: 'SHORT_SELECTION',
      menuSelectionActive: true,
      draftText: configured,
      kbChunks: [],
      tenantConfiguredSelection: true,
    });
    expect(out).toBe(configured);
  });
});
