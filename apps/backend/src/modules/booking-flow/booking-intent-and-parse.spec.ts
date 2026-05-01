import { describe, expect, it } from '@jest/globals';
import { parseSlotSelection } from './booking-intent-and-parse';

describe('parseSlotSelection', () => {
  const offered = [
    { option: 1, displayText: '10:00 AM', startIso: '2026-05-10T10:00:00.000Z' },
    { option: 2, displayText: '10:30 AM', startIso: '2026-05-10T10:30:00.000Z' },
    { option: 3, displayText: '11:00 AM', startIso: '2026-05-10T11:00:00.000Z' },
  ];

  it('maps "2" to second slot', () => {
    expect(parseSlotSelection('2', offered)).toEqual({ kind: 'option', option: 2 });
  });
});
