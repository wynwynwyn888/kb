import {
  curateMenuDocumentForCustomer,
  inferMenuSectionHint,
  prepareCustomerFacingMenuKb,
  userRequestsFullMenu,
} from './menu-kb-curator';

const FIXTURE = [
  'EMBER & SOY',
  'Ember & Soy is a modern Asian bistro.',
  'When responding to guests, keep suggestions selective.',
  '',
  'RESTAURANT MENU',
  'STARTERS',
  'A) Charred Wagyu Short Rib Bao',
  '12-hour braised short rib, hoisin glaze',
  'B) Spring Rolls',
  'Crisp vegetables',
  'C) Dumpling Trio',
  'Steamed and pan-fried',
  'D) Soup of the day',
  'Chef’s selection',
  'MAINS',
  'A) Grilled Sea Bass',
  'Lemon butter',
  'B) Beef Rendang',
  'Slow cooked',
].join('\n');

describe('menu-kb-curator', () => {
  it('1: strips internal intro before composing highlights', () => {
    const out = prepareCustomerFacingMenuKb(
      [
        {
          chunkId: '1',
          documentId: 'd',
          title: 'Menu doc',
          content: FIXTURE,
          source: 'manual',
          relevanceScore: 0.9,
          metadata: {},
        },
      ],
      { latestUserMessage: 'your menu', latestIntent: 'MENU' },
    );
    expect(out).toHaveLength(1);
    const text = out[0]!.content;
    expect(text).not.toMatch(/When responding to guests/i);
    expect(text).not.toMatch(/dining experience should feel/i);
    expect(text).toMatch(/Sure — our menu includes/i);
  });

  it('2: general menu query yields overview and limited items, not full dump', () => {
    const text = prepareCustomerFacingMenuKb(
      [
        {
          chunkId: '1',
          documentId: 'd',
          title: 'Menu',
          content: FIXTURE,
          source: 'manual',
          relevanceScore: 0.9,
          metadata: {},
        },
      ],
      { latestUserMessage: 'your menu', latestIntent: 'MENU' },
    )[0]!.content;
    expect(text).toMatch(/highlights/i);
    expect(text).not.toMatch(/When responding to guests/i);
    expect((text.match(/^\d+\./gm) ?? []).length).toBeLessThanOrEqual(4);
  });

  it('3: starters query focuses on starter items', () => {
    const text = curateMenuDocumentForCustomer({
      mergedKbText: FIXTURE,
      sectionHint: inferMenuSectionHint('show me starters', undefined),
      maxItems: 4,
      generalPreamble: false,
    });
    expect(text).toMatch(/Charred Wagyu|Spring Rolls|Dumpling/i);
    expect(text).not.toMatch(/Sea Bass/i);
    expect(text).not.toMatch(/Beef Rendang/i);
  });

  it('4: section hint from anchor label (mains)', () => {
    const hint = inferMenuSectionHint('B', 'Mains');
    expect(hint).toBe('mains');
  });

  it('detects full-menu phrasing for higher retrieval limits upstream', () => {
    expect(userRequestsFullMenu('can I see the full menu please')).toBe(true);
    expect(userRequestsFullMenu('your menu')).toBe(false);
  });
});
