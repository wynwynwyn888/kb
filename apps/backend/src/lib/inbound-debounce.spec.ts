import { bumpInboundDebounceMeta, shouldSkipStaleDebounceJob } from './inbound-debounce';

describe('inbound-debounce', () => {
  it('bumps pendingVersion monotonically', () => {
    const first = bumpInboundDebounceMeta({});
    expect(first.newVersion).toBe(1);
    const second = bumpInboundDebounceMeta(first.merged);
    expect(second.newVersion).toBe(2);
  });

  it('skips stale job when pendingVersion advanced', () => {
    const { merged } = bumpInboundDebounceMeta({});
    const { merged: merged2 } = bumpInboundDebounceMeta(merged);
    expect(shouldSkipStaleDebounceJob(merged2, 1)).toBe(true);
    expect(shouldSkipStaleDebounceJob(merged2, 2)).toBe(false);
  });

  it('multiple inbound bumps only latest job should run', () => {
    let m: Record<string, unknown> = {};
    for (let i = 0; i < 3; i++) {
      const b = bumpInboundDebounceMeta(m);
      m = b.merged;
    }
    expect((m['inboundDebounce'] as { pendingVersion: number }).pendingVersion).toBe(3);
    expect(shouldSkipStaleDebounceJob(m, 1)).toBe(true);
    expect(shouldSkipStaleDebounceJob(m, 2)).toBe(true);
    expect(shouldSkipStaleDebounceJob(m, 3)).toBe(false);
  });
});
