import {
  filterInboundRowsToBurstWindow,
  inboundBurstLookbackMs,
  INBOUND_DEBOUNCE_ENV_KEY,
  INBOUND_BURST_EXTRA_SLACK_MS,
  resolveInboundDebounceMs,
} from './inbound-burst-batch';

describe('resolveInboundDebounceMs', () => {
  const prev = process.env[INBOUND_DEBOUNCE_ENV_KEY];

  afterEach(() => {
    if (prev === undefined) delete process.env[INBOUND_DEBOUNCE_ENV_KEY];
    else process.env[INBOUND_DEBOUNCE_ENV_KEY] = prev;
  });

  it('defaults to 2000ms when env is missing', () => {
    delete process.env[INBOUND_DEBOUNCE_ENV_KEY];
    expect(resolveInboundDebounceMs()).toEqual({ debounceMs: 2000, debounceSource: 'default' });
  });

  it('respects env when set to a valid in-range value', () => {
    process.env[INBOUND_DEBOUNCE_ENV_KEY] = '3200';
    expect(resolveInboundDebounceMs()).toEqual({ debounceMs: 3200, debounceSource: 'env' });
  });

  it('clamps too-low values to 750ms', () => {
    process.env[INBOUND_DEBOUNCE_ENV_KEY] = '100';
    expect(resolveInboundDebounceMs()).toEqual({ debounceMs: 750, debounceSource: 'env' });
  });

  it('clamps too-high values to 10000ms', () => {
    process.env[INBOUND_DEBOUNCE_ENV_KEY] = '50000';
    expect(resolveInboundDebounceMs()).toEqual({ debounceMs: 10000, debounceSource: 'env' });
  });

  it('falls back to 2000ms for invalid env', () => {
    process.env[INBOUND_DEBOUNCE_ENV_KEY] = 'not-a-number';
    expect(resolveInboundDebounceMs()).toEqual({ debounceMs: 2000, debounceSource: 'default' });
  });

  it('falls back for non-integer strings', () => {
    process.env[INBOUND_DEBOUNCE_ENV_KEY] = '2000.5';
    expect(resolveInboundDebounceMs()).toEqual({ debounceMs: 2000, debounceSource: 'default' });
  });
});

describe('filterInboundRowsToBurstWindow', () => {
  it('keeps multiple messages inside debounce+slack window', () => {
    delete process.env[INBOUND_DEBOUNCE_ENV_KEY];
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
    delete process.env[INBOUND_DEBOUNCE_ENV_KEY];
    const newest = '2026-04-28T12:00:00.000Z';
    const old = new Date(new Date(newest).getTime() - inboundBurstLookbackMs() - 60_000).toISOString();
    const rows = [
      { created_at: newest, content: 'now' },
      { created_at: old, content: 'stale' },
    ];
    const out = filterInboundRowsToBurstWindow(rows);
    expect(out).toEqual(['now']);
  });

  it('lookback matches resolved debounce plus slack', () => {
    delete process.env[INBOUND_DEBOUNCE_ENV_KEY];
    const { debounceMs } = resolveInboundDebounceMs();
    expect(debounceMs + INBOUND_BURST_EXTRA_SLACK_MS).toBe(inboundBurstLookbackMs());
  });
});
