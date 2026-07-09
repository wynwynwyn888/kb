import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import {
  assembleCustomerFacingSegments,
  classifyKbParagraph,
  interpretRetrievalChunks,
  segmentKbContent,
} from './kb-chunk-interpretation';
import {
  collectOperatingHoursFromChunks,
  operatingHoursConflictDetected,
  resolveOperatingHoursConflictsAmongChunks,
} from './kb-operating-hours-conflict';
import { findSectionSliceByLabel, prepareCustomerFacingMenuKb } from './menu-kb-curator';
import {
  composeFactsOnlyFallbackFromKb,
  outboundContainsHardKbLeak,
  sanitizeOutboundInternalKbLeak,
} from './outbound-internal-kb-sanitizer';

function chunk(id: string, content: string, meta: Record<string, unknown> = {}): RetrievalChunk {
  return {
    chunkId: id,
    documentId: 'doc',
    title: 'Note',
    source: 'manual',
    relevanceScore: 0.9,
    content,
    metadata: meta,
  };
}

describe('KB production hardening', () => {
  it('1: mixed restaurant KB + internal guidance — internal paragraphs excluded from customer assembly', () => {
    const mixed = [
      'The dining experience should feel premium and unhurried.',
      'When responding to guests, keep tone warm and concise.',
      '',
      'Operating hours: 10am to 12am daily, including public holidays.',
      'Address: Marina Bay Sands, 10 Bayfront Ave, Singapore 018956',
    ].join('\n\n');
    const segs = segmentKbContent(mixed);
    const facing = assembleCustomerFacingSegments(segs);
    expect(facing).toMatch(/10am to 12am/i);
    expect(facing).toMatch(/Marina Bay Sands/i);
    expect(facing).not.toMatch(/dining experience should feel/i);
    expect(facing).not.toMatch(/When responding to guests/i);
  });

  it('2: operating hours query corpus — hours segments extractable', () => {
    const kb = [
      chunk('1', 'Random intro.\n\nWe are open 10am to 12am daily.'),
      chunk('2', 'Address: 10 Bayfront Ave.'),
    ];
    const interpreted = interpretRetrievalChunks(kb);
    const out = composeFactsOnlyFallbackFromKb('BUSINESS_HOURS', interpreted);
    expect(out).toMatch(/10am|12am|open/i);
    expect(out).not.toMatch(/dining experience should feel/i);
  });

  it('3: menu query without anchor → original chunks pass through (no fake categories)', () => {
    const c = chunk('m1', [
      'Internal: When responding to guests, be selective.',
      '',
      'SERVICE MENU',
      'A) Cuts',
      'B) Colour',
    ].join('\n'), { sectionTitle: 'SERVICE MENU' });
    const out = prepareCustomerFacingMenuKb([c], {
      latestUserMessage: 'menu pls',
      latestIntent: 'MENU',
    });
    expect(out).toEqual([c]);
  });

  it('4: anchor query slices only that section (universal section detection)', () => {
    const merged = [
      'OPENING HOURS',
      'Mon-Fri 10am-7pm',
      '',
      'COLOUR SERVICES',
      'Balayage from RM350',
      'Root touch up RM150',
      '',
      'HAIRCUT & STYLING',
      'Ladies cut RM80',
    ].join('\n');
    const slice = findSectionSliceByLabel(merged, 'Colour Services');
    expect(slice).not.toBeNull();
    const text = merged.slice(slice!.start, slice!.end);
    expect(text).toMatch(/Balayage|Root touch/i);
    expect(text).not.toMatch(/Ladies cut/i);
  });

  it('5: special request logging guidance is not in customer-facing assembly', () => {
    const p = 'SPECIAL REQUEST: Use this exact format when logging dietary notes for the team.';
    expect(classifyKbParagraph(p)).toBe('special_request_internal');
    const facing = assembleCustomerFacingSegments(segmentKbContent(p));
    expect(facing).toBe('');
  });

  it('6: complaint internal text excluded; COMPLAINT fallback is suppressed', () => {
    const note =
      'Complaint context: escalate to manager within 15 minutes.\n\n' +
      'We are open 10am to 10pm for guests who need help.';
    const segs = segmentKbContent(note);
    expect(segs.some(s => s.kind === 'complaint_flow_internal')).toBe(true);
    const facing = assembleCustomerFacingSegments(segs);
    expect(facing).not.toMatch(/Complaint context/i);
    const fb = composeFactsOnlyFallbackFromKb('COMPLAINT', [chunk('1', facing || 'hours 10am')]);
    expect(fb).not.toMatch(/Complaint context|escalate to manager/i);
    expect(fb).toBe('');
  });

  it('7: conflicting operating hours across chunks are detected and logged', () => {
    const chunks = [
      chunk('a', 'We are open 9am to 10pm daily.', { documentUpdatedAt: '2025-01-01T00:00:00Z' }),
      chunk('b', 'Hours: 10am to 12am every day including holidays.', {
        documentUpdatedAt: '2026-06-01T00:00:00Z',
      }),
    ];
    const interpreted = interpretRetrievalChunks(chunks);
    const { signatures } = collectOperatingHoursFromChunks(interpreted);
    expect(operatingHoursConflictDetected(signatures)).toBe(true);
    const logs: string[] = [];
    const resolved = resolveOperatingHoursConflictsAmongChunks(interpreted, m => logs.push(m));
    expect(logs.some(l => l.includes('KB conflict detected: operating_hours'))).toBe(true);
    const stillHours = resolved.filter(c => /10am to 12am/i.test(c.content ?? ''));
    expect(stillHours.length).toBeGreaterThanOrEqual(1);
  });

  it('outbound guard blocks verbatim internal phrases and rebuilds with KB when provided', () => {
    const leaked = 'Thanks for asking! When responding to guests, keep suggestions selective.';
    expect(outboundContainsHardKbLeak(leaked)).toBe(true);
    const kb = [chunk('h', 'Operating hours: 10am to 12am daily.')];
    const fixed = sanitizeOutboundInternalKbLeak(leaked, 'BUSINESS_HOURS', kb);
    expect(fixed).not.toMatch(/When responding to guests|selective/i);
    expect(fixed).toMatch(/10am|12am|open/i);
  });
});
