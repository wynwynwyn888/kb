import { buildRichTextChunkSpecs, splitNoteIntoSections, lineLooksLikeAllCapsHeading } from './kb-section-chunking';

describe('kb-section-chunking', () => {
  const sample = `
Welcome blurb about our business.

ADDRESS
123 Example Street

OPENING HOURS
Mon–Fri 9–5

## Colour services

Balayage from 120
Highlights from 90

SERVICE MENU

Cut & blow dry — 45
`;

  it('detects ALL CAPS lines as headings', () => {
    expect(lineLooksLikeAllCapsHeading('OPENING HOURS')).toBe(true);
    expect(lineLooksLikeAllCapsHeading('SERVICE MENU')).toBe(true);
    expect(lineLooksLikeAllCapsHeading('Hello world')).toBe(false);
  });

  it('splitNoteIntoSections orders preamble and titled sections', () => {
    const secs = splitNoteIntoSections(sample);
    const titles = secs.map(s => s.sectionTitle);
    expect(titles[0]).toBeNull();
    expect(titles).toContain('ADDRESS');
    expect(titles).toContain('OPENING HOURS');
    expect(titles).toContain('Colour services');
    expect(titles).toContain('SERVICE MENU');
    const hours = secs.find(s => s.sectionTitle === 'OPENING HOURS');
    expect(hours?.body).toMatch(/Mon/);
    const colour = secs.find(s => s.sectionTitle === 'Colour services');
    expect(colour?.body).toMatch(/Balayage/i);
  });

  it('buildRichTextChunkSpecs attaches section metadata and document title', () => {
    const iso = '2026-04-01T12:00:00.000Z';
    const specs = buildRichTextChunkSpecs({
      fullText: sample,
      documentTitle: 'Shop note',
      documentUpdatedAtIso: iso,
    });
    expect(specs.length).toBeGreaterThanOrEqual(4);
    const hours = specs.find(s => s.metadata['sectionTitle'] === 'OPENING HOURS');
    expect(hours).toBeDefined();
    expect(hours!.metadata['chunkType']).toBe('section');
    expect(hours!.metadata['documentTitle']).toBe('Shop note');
    expect(hours!.metadata['documentUpdatedAt']).toBe(iso);
    expect(hours!.metadata['updatedAt']).toBe(iso);
    expect(hours!.content).toMatch(/Mon/);
  });

  it('splits on horizontal rule into separate blocks', () => {
    const text = 'INTRO\nhello\n\n---\n\nPART TWO\nmore';
    const secs = splitNoteIntoSections(text);
    expect(secs.length).toBeGreaterThanOrEqual(2);
    expect(secs.some(s => s.body.includes('hello'))).toBe(true);
    expect(secs.some(s => s.sectionTitle === 'PART TWO')).toBe(true);
  });
});
