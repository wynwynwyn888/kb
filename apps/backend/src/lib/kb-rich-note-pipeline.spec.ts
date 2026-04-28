import { buildRichTextChunkSpecs } from './kb-section-chunking';
import { reconstructEditableNoteFromChunks } from './kb-rich-text-source';
import { rankChunksForKbSearch, type ScorableChunk } from './kb-retrieval-score';

const MULTI_SECTION_NOTE = `
Welcome to our studio.

ADDRESS
10 Example Road

OPENING HOURS
Mon–Fri 9–6

SERVICE MENU
Cut — 40
Colour — from 60

COLOUR SERVICES
Balayage — 120
`;

describe('KB rich note pipeline (generic sections)', () => {
  const iso = '2026-04-26T12:00:00.000Z';

  it('chunking produces multiple sections including ADDRESS, OPENING HOURS, SERVICE MENU', () => {
    const specs = buildRichTextChunkSpecs({
      fullText: MULTI_SECTION_NOTE,
      documentTitle: 'Note',
      documentUpdatedAtIso: iso,
    });
    expect(specs.length).toBeGreaterThan(1);
    const titles = specs.map(s => s.metadata['sectionTitle']);
    expect(titles).toContain('ADDRESS');
    expect(titles).toContain('OPENING HOURS');
    expect(titles).toContain('SERVICE MENU');
    expect(titles).toContain('COLOUR SERVICES');
  });

  it('reconstruct roundtrip preserves major headings', () => {
    const specs = buildRichTextChunkSpecs({
      fullText: MULTI_SECTION_NOTE,
      documentTitle: 'Note',
      documentUpdatedAtIso: iso,
    });
    const rows = specs.map((s, i) => ({
      id: `c${i}`,
      content: s.content,
      metadata: s.metadata,
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    const back = reconstructEditableNoteFromChunks(rows);
    expect(back).toMatch(/ADDRESS/);
    expect(back).toMatch(/OPENING HOURS/);
    expect(back).toMatch(/SERVICE MENU/);
  });

  it('search ranks menu / hour / address / balayage to expected sections', () => {
    const specs = buildRichTextChunkSpecs({
      fullText: MULTI_SECTION_NOTE,
      documentTitle: 'Note',
      documentUpdatedAtIso: iso,
    });
    const chunks: ScorableChunk[] = specs.map((s, i) => ({
      id: `c${i}`,
      documentId: 'd1',
      title: 'Note',
      source: 'rich_text',
      content: s.content,
      metadata: { ...s.metadata, documentUpdatedAt: iso },
    }));

    expect(rankChunksForKbSearch('menu', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle']).toMatch(/MENU/i);
    expect(rankChunksForKbSearch('hour', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle']).toMatch(/HOURS/i);
    expect(rankChunksForKbSearch('address', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle']).toMatch(/ADDRESS/i);
    expect(rankChunksForKbSearch('balayage', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle']).toMatch(/COLOUR/i);
  });

  it('rankChunksForKbSearch still returns hits when strict lexical match would be empty', () => {
    const chunks: ScorableChunk[] = [
      {
        id: 'x',
        documentId: 'd1',
        title: 'Note',
        source: 'rich_text',
        content: 'Orphan text without query tokens.',
        metadata: { chunkType: 'section', sectionTitle: 'MISC', sectionIndex: 0, documentUpdatedAt: iso },
      },
    ];
    const r = rankChunksForKbSearch('zzzznonexistenttoken', chunks, { topK: 3 });
    expect(r.length).toBe(1);
    expect(r[0]!.chunk.id).toBe('x');
  });
});
