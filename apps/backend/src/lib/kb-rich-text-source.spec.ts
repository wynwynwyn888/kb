import { reconstructEditableNoteFromChunks, KB_RICH_TEXT_SOURCE_METADATA_KEY } from './kb-rich-text-source';

describe('kb-rich-text-source', () => {
  it('exports stable metadata key', () => {
    expect(KB_RICH_TEXT_SOURCE_METADATA_KEY).toBe('richTextContent');
  });

  it('reconstructEditableNoteFromChunks restores headings for section chunks', () => {
    const rows = [
      {
        id: 'a',
        content: 'Intro body.',
        metadata: { chunkType: 'section', sectionTitle: null, sectionIndex: 0 },
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'b',
        content: '123 Main St',
        metadata: { chunkType: 'section', sectionTitle: 'ADDRESS', sectionIndex: 1, sectionPartIndex: 0 },
        createdAt: '2026-01-01T00:00:02.000Z',
      },
      {
        id: 'c',
        content: 'cont.',
        metadata: { chunkType: 'section', sectionTitle: 'ADDRESS', sectionIndex: 1, sectionPartIndex: 1 },
        createdAt: '2026-01-01T00:00:03.000Z',
      },
    ];
    const out = reconstructEditableNoteFromChunks(rows);
    expect(out).toContain('ADDRESS');
    expect(out).toContain('123 Main St');
    expect(out).toContain('cont.');
  });
});
