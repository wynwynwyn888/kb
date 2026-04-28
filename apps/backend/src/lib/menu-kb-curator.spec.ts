import {
  prepareCustomerFacingMenuKb,
  userRequestsFullMenu,
  findSectionSliceByLabel,
} from './menu-kb-curator';

describe('menu-kb-curator (universal — anchor-driven, no hardcoded categories)', () => {
  it('returns chunks unchanged when no anchor (plain MENU intent)', () => {
    const chunks = [
      {
        chunkId: 'c1',
        documentId: 'd',
        title: 'Service Menu',
        content: 'We offer haircuts, colour, and treatments.',
        source: 'rich_text' as const,
        relevanceScore: 0.9,
        metadata: { sectionTitle: 'SERVICE MENU' },
      },
    ];
    const out = prepareCustomerFacingMenuKb(chunks, {
      latestUserMessage: 'menu pls',
      latestIntent: 'MENU',
    });
    expect(out).toEqual(chunks);
  });

  it('with anchor matching a chunk sectionTitle → returns curated single chunk', () => {
    const chunks = [
      {
        chunkId: 'c1',
        documentId: 'd',
        title: 'Doc',
        content: 'COLOUR SERVICES\nBalayage, root touch up.',
        source: 'rich_text' as const,
        relevanceScore: 0.9,
        metadata: { sectionTitle: 'COLOUR SERVICES' },
      },
      {
        chunkId: 'c2',
        documentId: 'd',
        title: 'Doc',
        content: 'HAIRCUT & STYLING\nLadies cut, men cut.',
        source: 'rich_text' as const,
        relevanceScore: 0.85,
        metadata: { sectionTitle: 'HAIRCUT & STYLING' },
      },
    ];
    const out = prepareCustomerFacingMenuKb(chunks, {
      latestUserMessage: 'A',
      latestIntent: 'SHORT_SELECTION',
      menuAnchorLabel: 'Haircut & Styling',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.metadata['menuCurated']).toBe(true);
    expect(out[0]!.metadata['menuAnchorLabel']).toBe('Haircut & Styling');
    expect(out[0]!.content).toMatch(/Ladies cut|Haircut/i);
  });

  it('falls back to merged-text section slicing when no chunk matches the anchor exactly', () => {
    const merged = [
      'INTRO',
      'Welcome to Lumière.',
      '',
      'SERVICE MENU',
      'See below.',
      '',
      'OPENING HOURS',
      'Mon-Fri 9-7',
    ].join('\n');
    const slice = findSectionSliceByLabel(merged, 'OPENING HOURS');
    expect(slice).not.toBeNull();
    expect(merged.slice(slice!.start, slice!.end)).toMatch(/OPENING HOURS/);
    expect(merged.slice(slice!.start, slice!.end)).toMatch(/Mon-Fri/);
  });

  it('returns chunks unchanged when anchor matches nothing (no invented categories)', () => {
    const chunks = [
      {
        chunkId: 'c1',
        documentId: 'd',
        title: 'Service Menu',
        content: 'We offer haircuts and colour.',
        source: 'rich_text' as const,
        relevanceScore: 0.9,
        metadata: { sectionTitle: 'SERVICE MENU' },
      },
    ];
    const out = prepareCustomerFacingMenuKb(chunks, {
      latestUserMessage: 'A',
      latestIntent: 'SHORT_SELECTION',
      menuAnchorLabel: 'Quantum Foam Treatment',
    });
    expect(out).toEqual(chunks);
  });

  it('detects full-menu phrasing for higher retrieval limits upstream (universal vocab)', () => {
    expect(userRequestsFullMenu('can I see the full menu please')).toBe(true);
    expect(userRequestsFullMenu('show me the full services list')).toBe(true);
    expect(userRequestsFullMenu('your menu')).toBe(false);
  });
});
