import {
  filterInboundRowsToBurstWindow,
  inboundBurstLookbackMs,
  INBOUND_DEBOUNCE_MS,
  INBOUND_BURST_EXTRA_SLACK_MS,
} from './inbound-burst-batch';

describe('filterInboundRowsToBurstWindow', () => {
  it('keeps multiple messages inside debounce+slack window', () => {
    const t0 = '2026-04-28T10:00:00.000Z';
    const t1 = '2026-04-28T10:00:02.000Z';
    const t2 = '2026-04-28T10:00:03.000Z';
    const rows = [
      { created_at: t2, content: 'can i book neck massage?' },
      { created_at: t1, content: 'i have oily scalp and buildup' },
      { created_at: t0, content: 'older hi' },
    ];
    const out = filterInboundRowsToBurstWindow(rows);
    expect(out).toEqual(['older hi', 'i have oily scalp and buildup', 'can i book neck massage?']);
  });

  it('drops messages older than lookback from newest anchor', () => {
    const newest = '2026-04-28T12:00:00.000Z';
    const old = new Date(new Date(newest).getTime() - inboundBurstLookbackMs() - 60_000).toISOString();
    const rows = [
      { created_at: newest, content: 'now' },
      { created_at: old, content: 'stale' },
    ];
    const out = filterInboundRowsToBurstWindow(rows);
    expect(out).toEqual(['now']);
  });

  it('exports expected window parts', () => {
    expect(INBOUND_DEBOUNCE_MS + INBOUND_BURST_EXTRA_SLACK_MS).toBe(inboundBurstLookbackMs());
  });
});
