import { describe, expect, it } from 'vitest';
import { parseGhlFreeSlotsResponse } from './parse-ghl-free-slots-response.js';

describe('parseGhlFreeSlotsResponse', () => {
  it('parses top-level ISO string array (widget shape)', () => {
    const raw = ['2026-05-06T00:30:00+08:00', '2026-05-06T01:00:00+08:00', '2026-05-06T01:30:00+08:00'];
    const r = parseGhlFreeSlotsResponse(raw);
    expect(r.shapeSummary).toBe('topLevelIsoStringArray');
    expect(r.rawIsoStringCount).toBe(3);
    expect(r.slots).toHaveLength(3);
    expect(r.slots[0]!.startTime).toBe('2026-05-06T00:30:00+08:00');
    expect(r.slots[0]!.endTime).toBeUndefined();
  });

  it('derives endTime from slotDurationMinutes when provided', () => {
    const raw = ['2026-05-06T00:30:00+08:00'];
    const r = parseGhlFreeSlotsResponse(raw, { slotDurationMinutes: 30 });
    expect(r.slots).toHaveLength(1);
    expect(r.slots[0]!.startTime).toBe('2026-05-06T00:30:00+08:00');
    expect(r.slots[0]!.endTime).toBeDefined();
    expect(Date.parse(r.slots[0]!.endTime!)).toBeGreaterThan(Date.parse(r.slots[0]!.startTime));
  });

  it('parses { slots: ISO[] }', () => {
    const r = parseGhlFreeSlotsResponse({
      slots: ['2026-05-06T10:00:00Z', '2026-05-06T10:30:00Z'],
    });
    expect(r.shapeSummary).toBe('nestedIsoStringArray');
    expect(r.rawIsoStringCount).toBe(2);
    expect(r.slots).toHaveLength(2);
  });

  it('parses { availableSlots: ISO[] }', () => {
    const r = parseGhlFreeSlotsResponse({
      availableSlots: ['2026-05-07T12:00:00+08:00'],
    });
    expect(r.shapeSummary).toBe('nestedIsoStringArray');
    expect(r.slots).toHaveLength(1);
  });

  it('parses { data: ISO[] }', () => {
    const r = parseGhlFreeSlotsResponse({
      data: ['2026-05-08T09:00:00.000Z'],
    });
    expect(r.slots).toHaveLength(1);
    expect(r.shapeSummary).toBe('nestedIsoStringArray');
  });

  it('parses date-keyed string arrays', () => {
    const r = parseGhlFreeSlotsResponse({
      '2026-05-06': ['2026-05-06T00:30:00+08:00', '2026-05-06T01:00:00+08:00'],
    });
    expect(r.shapeSummary).toBe('dateKeyedMap');
    expect(r.slots).toHaveLength(2);
    expect(r.dateKeys.length).toBeGreaterThan(0);
  });

  it('parses date-keyed object slots (legacy)', () => {
    const r = parseGhlFreeSlotsResponse({
      '2026-05-06': [
        { startTime: '2026-05-06T02:00:00Z', endTime: '2026-05-06T02:30:00Z' },
      ],
    });
    expect(r.shapeSummary).toBe('dateKeyedMap');
    expect(r.slots).toHaveLength(1);
    expect(r.slots[0]!.endTime).toBe('2026-05-06T02:30:00Z');
  });

  it('ignores invalid strings in mixed array', () => {
    const r = parseGhlFreeSlotsResponse(['2026-05-06T00:30:00+08:00', 'not-a-date', '', 'foo']);
    expect(r.shapeSummary).toBe('topLevelMixedIsoStringArray');
    expect(r.rawIsoStringCount).toBe(1);
    expect(r.slots).toHaveLength(1);
  });
});
