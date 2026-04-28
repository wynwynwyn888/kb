/**
 * Realistic multi-section note to validate the GENERIC heading detector.
 * The body is salon-flavoured only because the production bug surfaced on a salon note —
 * the parser itself contains zero salon-specific code.
 */
import {
  buildRichTextChunkSpecs,
  classifyHeadingLines,
  detectHeading,
  splitNoteIntoSections,
  normalizeNoteText,
} from './kb-section-chunking';
import { rankChunksForKbSearch, type ScorableChunk } from './kb-retrieval-score';

const SALON_LIKE_NOTE = `
LUMIÈRE HAIR ATELIER

Lumière Hair Atelier is a premium boutique hair salon in the heart of the city,
focused on personalised consultations and natural-looking results.

ADDRESS
88 Tanjong Pagar Road
#02-15
Singapore 088512

OPENING HOURS
Mon–Fri 10:00–19:00
Saturday 09:00–18:00
Sunday closed

CONTACT
WhatsApp: +65 8000 0000
Email: hello@lumiere.example

SERVICE MENU
We offer a curated set of services across cut, colour, perm and treatments.
Pricing varies by stylist tier.

HAIRCUT & STYLING
Ladies cut from $80
Men cut from $50
Kids cut from $35
Blow-dry from $45

COLOUR SERVICES
Balayage from $260
Highlights from $180
Root touch-up from $95
Toner from $65

PERM & REBONDING
Cold perm from $200
Digital perm from $260
Rebonding from $300

HAIR & SCALP TREATMENTS
Keratin treatment from $220
Scalp detox from $90
Olaplex add-on from $40

CONSULTATION
Free 15-minute consultation for new guests.
Patch test required for colour-sensitive guests.

SERVICE RECOMMENDATION GUIDE
Fine hair: lighter products
Coarse hair: deeper conditioning

BOOKING GUIDANCE
Please share preferred date and stylist.
We confirm availability via WhatsApp.

BOOKING POLICY
50% deposit required for colour services.

CANCELLATION POLICY
Reschedule up to 24 hours before.
Late cancellations may forfeit deposit.

FIRST-TIME GUEST NOTES
Arrive 10 minutes early so we can complete a quick consultation.

AFTERCARE
After keratin treatment, avoid sulfates for 72 hours.
Wait 48 hours before washing colour-treated hair.

ALLERGY AND SENSITIVITY GUIDANCE
Inform stylist of any allergies prior to colour service.

COMPLAINT HANDLING
We take feedback seriously. Please contact the front desk.
Refunds are considered case-by-case.

HUMAN HANDOVER
For urgent issues, ask to speak with the salon manager.
`.trim();

describe('section chunking on a realistic multi-section note (universal)', () => {
  const iso = '2026-04-28T12:00:00.000Z';

  it('normalizeNoteText converts CRLF, lone CR, line-separator and NBSP', () => {
    const messy =
      '\uFEFFHEAD\r\nbody1\rbody2\u2028body3\u00A0space\u202Fnarrow';
    const out = normalizeNoteText(messy);
    expect(out).toBe('HEAD\nbody1\nbody2\nbody3 space narrow');
  });

  it('detectHeading recognises all expected universal heading shapes', () => {
    expect(detectHeading('# Big').isHeading).toBe(true);
    expect(detectHeading('## Sub').isHeading).toBe(true);
    expect(detectHeading('**ADDRESS**').isHeading).toBe(true);
    expect(detectHeading('ADDRESS').isHeading).toBe(true);
    expect(detectHeading('OPENING HOURS').isHeading).toBe(true);
    expect(detectHeading('HAIRCUT & STYLING').isHeading).toBe(true);
    expect(detectHeading('PERM & REBONDING').isHeading).toBe(true);
    expect(detectHeading('Opening Hours:').isHeading).toBe(true);
    expect(detectHeading('LUMIÈRE HAIR ATELIER').isHeading).toBe(true);

    expect(detectHeading('We are open from 10am to 7pm.').isHeading).toBe(false);
    expect(detectHeading('Mon–Fri 9–6').isHeading).toBe(false);
    expect(detectHeading('123 Example Street').isHeading).toBe(false);
  });

  it('classifyHeadingLines surfaces detection reasons for diagnostics', () => {
    const sample = classifyHeadingLines(SALON_LIKE_NOTE, 30);
    const titles = sample
      .filter(s => s.isHeading)
      .map(s => s.trimmedPreview.toUpperCase());
    expect(titles).toEqual(
      expect.arrayContaining([
        'LUMIÈRE HAIR ATELIER',
        'ADDRESS',
        'OPENING HOURS',
        'CONTACT',
        'SERVICE MENU',
        'HAIRCUT & STYLING',
        'COLOUR SERVICES',
      ]),
    );
  });

  it('splits salon-like note into many sections without hardcoded headings', () => {
    const secs = splitNoteIntoSections(SALON_LIKE_NOTE);
    const titles = secs.map(s => s.sectionTitle).filter(Boolean) as string[];
    expect(titles.length).toBeGreaterThanOrEqual(12);
    expect(titles).toEqual(
      expect.arrayContaining([
        'ADDRESS',
        'OPENING HOURS',
        'CONTACT',
        'SERVICE MENU',
        'HAIRCUT & STYLING',
        'COLOUR SERVICES',
        'PERM & REBONDING',
        'HAIR & SCALP TREATMENTS',
        'CONSULTATION',
        'BOOKING POLICY',
        'CANCELLATION POLICY',
        'AFTERCARE',
        'COMPLAINT HANDLING',
        'HUMAN HANDOVER',
      ]),
    );
  });

  it('buildRichTextChunkSpecs emits required metadata on every chunk', () => {
    const specs = buildRichTextChunkSpecs({
      fullText: SALON_LIKE_NOTE,
      documentTitle: 'Lumière Hair Atelier',
      documentUpdatedAtIso: iso,
    });
    expect(specs.length).toBeGreaterThan(10);
    for (const s of specs) {
      expect(s.metadata['chunkType']).toBe('section');
      expect(typeof s.metadata['sectionIndex']).toBe('number');
      expect(typeof s.metadata['sectionPartIndex']).toBe('number');
      expect(s.metadata['documentTitle']).toBe('Lumière Hair Atelier');
      expect(s.metadata['documentUpdatedAt']).toBe(iso);
      expect(s.metadata['updatedAt']).toBe(iso);
    }
  });

  it('search ranks well-known intents to the right sections (universal scoring)', () => {
    const specs = buildRichTextChunkSpecs({
      fullText: SALON_LIKE_NOTE,
      documentTitle: 'Lumière Hair Atelier',
      documentUpdatedAtIso: iso,
    });
    const chunks: ScorableChunk[] = specs.map((s, i) => ({
      id: `c${i}`,
      documentId: 'd1',
      title: 'Lumière Hair Atelier',
      source: 'rich_text',
      content: s.content,
      metadata: { ...s.metadata, documentUpdatedAt: iso },
    }));

    expect(rankChunksForKbSearch('hour', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle']).toMatch(
      /HOURS/i,
    );
    expect(
      rankChunksForKbSearch('location', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle'],
    ).toMatch(/ADDRESS/i);
    expect(rankChunksForKbSearch('menu', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle']).toMatch(
      /MENU/i,
    );
    expect(
      rankChunksForKbSearch('balayage', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle'],
    ).toMatch(/COLOUR/i);
    expect(
      rankChunksForKbSearch('keratin', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle'],
    ).toMatch(/HAIR & SCALP TREATMENTS/i);
    expect(
      rankChunksForKbSearch('after keratin', chunks, { topK: 3 })[0]?.chunk.metadata['sectionTitle'],
    ).toMatch(/AFTERCARE/i);
    const refundTop = rankChunksForKbSearch('refund', chunks, { topK: 3 })[0]?.chunk.metadata[
      'sectionTitle'
    ];
    expect(String(refundTop)).toMatch(/COMPLAINT|CANCELLATION/i);
  });

  it('content with no real newlines (single-line paste) still flags suspicious-but-recoverable behaviour', () => {
    // Simulates a paste that lost line breaks. Even a degenerate input should not crash and
    // should NOT spuriously detect headings — so callers can rely on the diagnostic warning.
    const oneLine = SALON_LIKE_NOTE.replace(/\n+/g, ' ');
    const specs = buildRichTextChunkSpecs({
      fullText: oneLine,
      documentTitle: 'Lumière Hair Atelier',
      documentUpdatedAtIso: iso,
    });
    expect(specs.length).toBeGreaterThanOrEqual(1);
    // Confirm the diagnostic helper would tell operators the content has no headings.
    const sample = classifyHeadingLines(oneLine, 20);
    expect(sample.every(s => !s.isHeading)).toBe(true);
  });
});
