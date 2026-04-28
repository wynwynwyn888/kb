import { rankChunksByRelevance, buildSnippetAroundQuery, type ScorableChunk } from './kb-retrieval-score';

function docChunks(): ScorableChunk[] {
  const base = {
    documentId: 'd1',
    title: 'Policies',
    source: 'rich_text',
  };
  return [
    {
      ...base,
      id: 'intro',
      content: 'Welcome to our venue. We care about quality.',
      metadata: { chunkType: 'section', sectionTitle: null, sectionIndex: 0, documentUpdatedAt: '2026-01-01T00:00:00Z' },
    },
    {
      ...base,
      id: 'hours',
      content: 'Mon–Fri 9am–6pm, Sat 10–4.',
      metadata: { chunkType: 'section', sectionTitle: 'OPENING HOURS', sectionIndex: 1, documentUpdatedAt: '2026-01-01T00:00:00Z' },
    },
    {
      ...base,
      id: 'menu',
      content: 'Cut & colour — from 50\nBlow dry — 35',
      metadata: { chunkType: 'section', sectionTitle: 'SERVICE MENU', sectionIndex: 2, documentUpdatedAt: '2026-01-01T00:00:00Z' },
    },
    {
      ...base,
      id: 'colour',
      content: 'Balayage full head — 120\nFoils — from 95',
      metadata: { chunkType: 'section', sectionTitle: 'COLOUR SERVICES', sectionIndex: 3, documentUpdatedAt: '2026-01-01T00:00:00Z' },
    },
    {
      ...base,
      id: 'addr',
      content: '123 High Street, Exampletown.',
      metadata: { chunkType: 'section', sectionTitle: 'ADDRESS', sectionIndex: 4, documentUpdatedAt: '2026-01-01T00:00:00Z' },
    },
  ];
}

describe('kb-retrieval-score', () => {
  it('rankChunks: "hour" prefers OPENING HOURS over intro', () => {
    const ranked = rankChunksByRelevance('hour', docChunks());
    expect(ranked[0]?.chunk.id).toBe('hours');
  });

  it('rankChunks: "menu" prefers SERVICE MENU chunk', () => {
    const ranked = rankChunksByRelevance('menu pls', docChunks());
    expect(ranked[0]?.chunk.id).toBe('menu');
  });

  it('rankChunks: "balayage" prefers section containing the term', () => {
    const ranked = rankChunksByRelevance('balayage', docChunks());
    expect(ranked[0]?.chunk.id).toBe('colour');
  });

  it('rankChunks: "address" prefers ADDRESS section', () => {
    const ranked = rankChunksByRelevance('address', docChunks());
    expect(ranked[0]?.chunk.id).toBe('addr');
  });

  it('buildSnippetAroundQuery leads with heading when heading matches query', () => {
    const sn = buildSnippetAroundQuery('Mon–Fri 9–5', 'hours', 120, 'OPENING HOURS');
    expect(sn.toLowerCase()).toContain('opening');
    expect(sn.toLowerCase()).toContain('mon');
  });
});
