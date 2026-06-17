import { describe, expect, it } from 'vitest';
import {
  countEventsMatchingSlotStart,
  parseGhlCalendarEventsResponse,
  sameMinuteIso,
} from './parse-ghl-calendar-events.js';

describe('parseGhlCalendarEventsResponse', () => {
  it('parses events array', () => {
    const starts = parseGhlCalendarEventsResponse({
      events: [{ startTime: '2026-06-10T10:00:00-05:00' }, { startTime: '2026-06-10T11:00:00-05:00' }],
    });
    expect(starts).toHaveLength(2);
  });

  it('counts matching slot at minute precision', () => {
    expect(
      countEventsMatchingSlotStart(
        ['2026-06-10T10:00:30-05:00', '2026-06-10T11:00:00-05:00'],
        '2026-06-10T10:00:00-05:00',
      ),
    ).toBe(1);
    expect(sameMinuteIso('2026-06-10T15:00:00.000Z', '2026-06-10T15:00:30.000Z')).toBe(true);
  });
});
