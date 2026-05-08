import { describe, it, expect } from '@jest/globals';
import { expandKbQueryWithIntent } from './kb-intent-synonyms';
import {
  buildSnippetAroundQuery,
  computeKbSearchHitPresentation,
  normalizeKbSearchScores,
  rankChunksForKbSearch,
  scoreChunkForQuery,
  sectionHeadingStrength,
  type ScorableChunk,
} from './kb-retrieval-score';

const ISO = '2026-04-26T12:00:00.000Z';

function chunk(partial: Partial<ScorableChunk> & Pick<ScorableChunk, 'content'>): ScorableChunk {
  return {
    id: partial.id ?? `c-${Math.random().toString(36).slice(2, 8)}`,
    documentId: partial.documentId ?? 'd1',
    title: partial.title ?? 'Note',
    source: partial.source ?? 'rich_text',
    content: partial.content,
    metadata: { documentUpdatedAt: ISO, ...(partial.metadata ?? {}) },
  };
}

describe('expandKbQueryWithIntent', () => {
  it('"hour" → INTENT_HOURS with section title hint "hours"', () => {
    const out = expandKbQueryWithIntent('hour');
    expect(out.intents).toContain('INTENT_HOURS');
    expect(out.sectionTitleHints.some(h => h.toLowerCase().includes('hour'))).toBe(true);
  });

  it('"location" or "where" → INTENT_ADDRESS with hint "address"', () => {
    expect(expandKbQueryWithIntent('location').intents).toContain('INTENT_ADDRESS');
    expect(expandKbQueryWithIntent('where are you').intents).toContain('INTENT_ADDRESS');
    expect(expandKbQueryWithIntent('location').sectionTitleHints).toContain('address');
  });

  it('"menu" → INTENT_MENU; "refund" → INTENT_COMPLAINT', () => {
    expect(expandKbQueryWithIntent('menu').intents).toContain('INTENT_MENU');
    expect(expandKbQueryWithIntent('refund please').intents).toContain('INTENT_COMPLAINT');
  });

  it('"menu" / "services" → broadMenuListingQuery; "keratin" → not broad', () => {
    expect(expandKbQueryWithIntent('menu').broadMenuListingQuery).toBe(true);
    expect(expandKbQueryWithIntent('services').broadMenuListingQuery).toBe(true);
    expect(expandKbQueryWithIntent('what do you offer').broadMenuListingQuery).toBe(true);
    expect(expandKbQueryWithIntent('keratin').broadMenuListingQuery).toBe(false);
  });

  it('"menu pls" → broad menu listing (chat shorthand)', () => {
    expect(expandKbQueryWithIntent('menu pls').broadMenuListingQuery).toBe(true);
  });

  it('"grooming?" maps to INTENT_MENU', () => {
    expect(expandKbQueryWithIntent('grooming?').intents).toContain('INTENT_MENU');
  });

  it('aftercareIntent for post-care phrasing', () => {
    expect(expandKbQueryWithIntent('after keratin').aftercareIntent).toBe(true);
    expect(expandKbQueryWithIntent('aftercare guide').aftercareIntent).toBe(true);
    expect(expandKbQueryWithIntent('keratin').aftercareIntent).toBe(false);
  });

  it('intentHint enum names map to the right intent group', () => {
    expect(expandKbQueryWithIntent('', 'BUSINESS_HOURS').intents).toContain('INTENT_HOURS');
    expect(expandKbQueryWithIntent('', 'LOCATION').intents).toContain('INTENT_ADDRESS');
    expect(expandKbQueryWithIntent('', 'MENU').intents).toContain('INTENT_MENU');
  });
});

describe('scoreChunkForQuery (universal heading boost)', () => {
  const opening = chunk({
    id: 'opening',
    title: 'Studio policy',
    content: 'Mon–Fri 9 to 6\nSat 10 to 4',
    metadata: { sectionTitle: 'OPENING HOURS', chunkType: 'section', sectionIndex: 1 },
  });

  const colour = chunk({
    id: 'colour',
    title: 'Studio policy',
    content: 'Balayage from 120, root touch-up from 70',
    metadata: { sectionTitle: 'COLOUR SERVICES', chunkType: 'section', sectionIndex: 4 },
  });

  const intro = chunk({
    id: 'intro',
    title: 'Studio policy',
    content: 'Welcome to our studio.',
    metadata: { sectionTitle: null, chunkType: 'section', sectionIndex: 0 },
  });

  it('"hour" beats colour services (heading hint boost)', () => {
    const sOpen = scoreChunkForQuery('hour', opening);
    const sColour = scoreChunkForQuery('hour', colour);
    expect(sOpen).toBeGreaterThan(sColour);
  });

  it('"balayage" beats hours (token in colour content)', () => {
    expect(scoreChunkForQuery('balayage', colour)).toBeGreaterThan(scoreChunkForQuery('balayage', opening));
  });

  it('intro chunks lose to titled sections for substantive queries', () => {
    expect(scoreChunkForQuery('hour', opening)).toBeGreaterThan(scoreChunkForQuery('hour', intro));
  });
});

describe('normalizeKbSearchScores', () => {
  it('strict match leader is 1.0 and bestEffort is false', () => {
    const ranked = [
      { chunk: chunk({ content: 'open hours' }), score: 12 },
      { chunk: chunk({ content: 'other' }), score: 4 },
    ];
    const out = normalizeKbSearchScores(ranked);
    expect(out[0]!.score).toBeCloseTo(1, 5);
    expect(out[0]!.bestEffort).toBe(false);
  });

  it('best-effort hits are capped at 0.2 (never 100%)', () => {
    const ranked = [{ chunk: chunk({ content: 'other' }), score: 0, bestEffort: true }];
    const out = normalizeKbSearchScores(ranked);
    expect(out[0]!.score).toBeLessThanOrEqual(0.2);
    expect(out[0]!.bestEffort).toBe(true);
  });
});

describe('rankChunksForKbSearch (acceptance)', () => {
  const chunks: ScorableChunk[] = [
    chunk({
      id: 'addr',
      content: '10 Example Road, Suite 7',
      metadata: { sectionTitle: 'ADDRESS', chunkType: 'section', sectionIndex: 1 },
    }),
    chunk({
      id: 'open',
      content: 'Mon–Fri 9–6\nSat 10–4',
      metadata: { sectionTitle: 'OPENING HOURS', chunkType: 'section', sectionIndex: 2 },
    }),
    chunk({
      id: 'svc',
      content: 'Cut — 40\nColour — from 60',
      metadata: { sectionTitle: 'SERVICE MENU', chunkType: 'section', sectionIndex: 3 },
    }),
    chunk({
      id: 'col',
      content: 'Balayage — 120',
      metadata: { sectionTitle: 'COLOUR SERVICES', chunkType: 'section', sectionIndex: 4 },
    }),
  ];

  it('"hour" → OPENING HOURS', () => {
    expect(rankChunksForKbSearch('hour', chunks, { topK: 3 })[0]!.chunk.id).toBe('open');
  });

  it('"location" → ADDRESS', () => {
    expect(rankChunksForKbSearch('location', chunks, { topK: 3 })[0]!.chunk.id).toBe('addr');
  });

  it('"menu" → SERVICE MENU', () => {
    expect(rankChunksForKbSearch('menu', chunks, { topK: 3 })[0]!.chunk.id).toBe('svc');
  });

  it('"balayage" → COLOUR SERVICES', () => {
    expect(rankChunksForKbSearch('balayage', chunks, { topK: 3 })[0]!.chunk.id).toBe('col');
  });
});

describe('rankChunksForKbSearch (menu vs categories)', () => {
  const chunks: ScorableChunk[] = [
    chunk({
      id: 'svc',
      content: 'We offer a curated set of services.\nCut from $40',
      metadata: { sectionTitle: 'SERVICE MENU', chunkType: 'section', sectionIndex: 2 },
    }),
    chunk({
      id: 'col',
      content: 'Balayage from $260',
      metadata: { sectionTitle: 'COLOUR SERVICES', chunkType: 'section', sectionIndex: 4 },
    }),
    chunk({
      id: 'hair',
      content: 'Ladies cut from $80',
      metadata: { sectionTitle: 'HAIRCUT AND STYLING SERVICES', chunkType: 'section', sectionIndex: 3 },
    }),
  ];

  it('"menu" ranks SERVICE MENU above category service sections', () => {
    expect(rankChunksForKbSearch('menu', chunks, { topK: 3 })[0]!.chunk.id).toBe('svc');
  });
});

describe('rankChunksForKbSearch (keratin vs aftercare)', () => {
  const chunks: ScorableChunk[] = [
    chunk({
      id: 'treat',
      content: 'Keratin Smooth Treatment\nFrom $220',
      metadata: { sectionTitle: 'HAIR AND SCALP TREATMENTS', chunkType: 'section', sectionIndex: 1 },
    }),
    chunk({
      id: 'after',
      content: 'After keratin treatment, avoid sulfates for 72 hours.',
      metadata: { sectionTitle: 'AFTERCARE', chunkType: 'section', sectionIndex: 2 },
    }),
  ];

  it('"keratin" prefers treatment section over aftercare', () => {
    expect(rankChunksForKbSearch('keratin', chunks, { topK: 2 })[0]!.chunk.id).toBe('treat');
  });

  it('"after keratin" prefers aftercare section', () => {
    expect(rankChunksForKbSearch('after keratin', chunks, { topK: 2 })[0]!.chunk.id).toBe('after');
  });
});

describe('sectionHeadingStrength (weak vs strong)', () => {
  it('penalises sentence-like headings', () => {
    expect(sectionHeadingStrength('ADDRESS')).toBe(1);
    expect(sectionHeadingStrength('The salon offers these main service categories')).toBeLessThan(0.75);
  });

  it('"location" ranks ADDRESS above a weak helper heading without address hints', () => {
    const weak = chunk({
      id: 'w',
      content: '88 Example Road\nSingapore',
      metadata: { sectionTitle: 'The nearest MRT station', chunkType: 'section', sectionIndex: 1 },
    });
    const strong = chunk({
      id: 's',
      content: '88 Example Road\nSingapore',
      metadata: { sectionTitle: 'ADDRESS', chunkType: 'section', sectionIndex: 2 },
    });
    expect(scoreChunkForQuery('location', strong)).toBeGreaterThan(scoreChunkForQuery('location', weak));
  });
});

describe('computeKbSearchHitPresentation', () => {
  it('does not assign 100% for weak token-only matches', () => {
    const c = chunk({
      content: 'Unrelated prose without the raretoken.',
      metadata: { sectionTitle: 'MISC SECTION', chunkType: 'section', sectionIndex: 0 },
    });
    const out = computeKbSearchHitPresentation({
      query: 'zqxxyz123',
      chunk: c,
      normalizedScore: 1,
      bestEffort: false,
    });
    expect(out.scorePercent).toBeLessThan(100);
  });

  it('marks best-effort with low scorePercent', () => {
    const c = chunk({ content: 'x', metadata: { sectionTitle: 'Y' } });
    const out = computeKbSearchHitPresentation({
      query: 'zzz',
      chunk: c,
      normalizedScore: 0.15,
      bestEffort: true,
    });
    expect(out.relevanceLabel).toBe('BEST_EFFORT');
    expect(out.scorePercent).toBeLessThanOrEqual(28);
  });
});

describe('rankChunksForKbSearch (pet services)', () => {
  const chunks: ScorableChunk[] = [
    chunk({
      id: 'groom',
      content: 'Full Groom includes bath, brush-out, and tidy.',
      metadata: { sectionTitle: 'GROOMING SERVICES', chunkType: 'section', sectionIndex: 1 },
    }),
    chunk({
      id: 'pol',
      content: 'We love anxious pets and take introductions slowly.',
      metadata: { sectionTitle: 'GENERAL POLICIES', chunkType: 'section', sectionIndex: 2 },
    }),
  ];

  it('"grooming?" prefers grooming catalog section', () => {
    expect(rankChunksForKbSearch('grooming?', chunks, { topK: 2 })[0]!.chunk.id).toBe('groom');
  });
});

describe('buildSnippetAroundQuery', () => {
  it('leads with sectionTitle when intent matches heading', () => {
    const text = 'Mon–Fri 9 to 6\nSat 10 to 4';
    const snippet = buildSnippetAroundQuery(text, 'hour', 240, 'OPENING HOURS');
    expect(snippet).toMatch(/^OPENING HOURS — /);
  });
});
