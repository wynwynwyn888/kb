import { describe, expect, it } from 'vitest';
import { parseApiInstantMs, relativeTimeLabel } from './datetime-display';

describe('datetime-display', () => {
  it('parseApiInstantMs treats naive ISO as UTC', () => {
    const ms = parseApiInstantMs('2026-04-28T12:00:00.000');
    expect(ms).toBe(Date.parse('2026-04-28T12:00:00.000Z'));
  });

  it('relative label shows just now after PATCH-style fresh timestamp', () => {
    const now = Date.parse('2026-04-28T15:00:00.000Z');
    const updated = '2026-04-28T14:59:50.000Z';
    expect(relativeTimeLabel(updated, now)).toBe('just now');
  });

  it('parses Postgres-like space separator with offset', () => {
    const ms = parseApiInstantMs('2026-04-28 12:00:00+00:00');
    expect(ms).not.toBeNull();
  });
});
